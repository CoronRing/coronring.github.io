"""
Signed links, so the service can act on a click without holding the state.

A confirmation link has to carry an address the service has not stored yet,
and an unsubscribe link has to keep working for as long as someone is on the
list. Both are solved the same way: put the address in the link and sign it.

This is what lets the service store **nothing** until a reader has clicked:
an unconfirmed signup leaves no row anywhere, so the endpoint cannot be used
to build a list of addresses it was handed. It also means an unsubscribe link
is a pure function of the address, so the same one keeps working across every
digest and across a restore from backup.

The signature is HMAC-SHA256 over the whole payload with `NEWS_TOKEN_SECRET`.
Rotating that secret invalidates every outstanding link, which is the correct
behaviour and the reason it is never regenerated on boot.
"""

from __future__ import annotations

import base64
import hmac
import time
from hashlib import sha256

from .settings import settings

#: Bumped if the payload layout ever changes, so old links fail closed.
VERSION = "1"

#: Separator. Not legal in an email address or in a purpose, so the payload
#: cannot be made ambiguous by a crafted address.
SEP = "|"


class TokenError(Exception):
    """A token was malformed, had the wrong purpose, expired, or did not verify."""


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _unb64(raw: str) -> bytes:
    return base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))


def _sign(payload: bytes) -> str:
    if not settings.token_secret:
        raise TokenError("no signing secret configured")
    return _b64(hmac.new(settings.token_secret.encode("utf-8"), payload, sha256).digest())


def issue(purpose: str, email: str, *, ttl_s: int | None = None, now: float | None = None) -> str:
    """Mint a signed link token.

    Args:
        purpose: What the token authorises, checked on the way back in. A
            confirmation token must not work as an unsubscribe token, or a
            signup would silently remove an existing reader.
        email: The address the token speaks for.
        ttl_s: Seconds the token is good for, or None for no expiry. An
            unsubscribe token never expires, because the alternative is a
            reader who cannot leave.
        now: Current time, for tests.

    Returns:
        An opaque, URL-safe string.
    """
    expires = 0 if ttl_s is None else int((now or time.time()) + ttl_s)
    payload = SEP.join((VERSION, purpose, email, str(expires))).encode("utf-8")
    return f"{_b64(payload)}.{_sign(payload)}"


def verify(token: str, purpose: str, *, now: float | None = None) -> str:
    """Check a token and return the address it speaks for.

    The signature is checked before anything in the payload is believed, and
    compared with `hmac.compare_digest` so a wrong token cannot be narrowed
    down by timing.

    Args:
        token: The token from the link.
        purpose: The purpose it must carry.
        now: Current time, for tests.

    Returns:
        The email address.

    Raises:
        TokenError: On anything at all wrong with it. The caller shows one
            message for every case, because telling a stranger whether their
            forged token expired or failed to verify helps only them.
    """
    try:
        body, signature = token.split(".", 1)
        payload = _unb64(body)
    except (ValueError, TypeError, base64.binascii.Error) as exc:  # type: ignore[attr-defined]
        raise TokenError("malformed token") from exc

    if not hmac.compare_digest(signature, _sign(payload)):
        raise TokenError("bad signature")

    try:
        version, got_purpose, email, expires = payload.decode("utf-8").split(SEP)
    except ValueError as exc:
        raise TokenError("malformed payload") from exc

    if version != VERSION:
        raise TokenError("stale token version")
    if not hmac.compare_digest(got_purpose, purpose):
        raise TokenError("wrong purpose")
    if expires != "0" and float(expires) < (now or time.time()):
        raise TokenError("expired")
    return email
