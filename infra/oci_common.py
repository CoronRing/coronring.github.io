"""
Shared OCI plumbing: credentials, retries, and find-or-create helpers.

Two things here are not incidental.

**Retries wrap every call.** A young OCI tenancy answers the same request with
200, then 401, then 404 within seconds while it finishes provisioning. Without
retries a script reports a working, fully-privileged key as broken — which is
exactly what happened the first time these credentials were checked.

**Everything is find-or-create, keyed on display name.** Provisioning has to be
safe to re-run: a half-finished attempt should be completed rather than
duplicated, because duplicate VCNs and orphaned instances quietly eat an
always-free allowance that has room for exactly one small deployment.
"""

from __future__ import annotations

import hashlib
import os
import re
import tempfile
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, TypeVar

import oci

ROOT = Path(__file__).resolve().parent.parent
T = TypeVar("T")

# One prefix for everything this project creates, so it is obvious in the
# console what may be deleted and what belongs to something else.
PREFIX = "particle-wave"


# ──────────────────────────────────────────────────────────────────────────
# Credentials
# ──────────────────────────────────────────────────────────────────────────


# The credentials these scripts need, in the order of preference they are
# looked up: a .env beside the repository root first, the process environment
# second. A developer machine has the file; a CI runner has no file and no home
# directory worth the name, so it passes the same three values as secrets.
CREDENTIAL_KEYS = ("ORACLE_CONFIGURATION", "ORACLE_API_KEY", "ORACLE_SSH_PUBLIC_KEY")


def read_env() -> dict[str, str]:
    """
    Parse .env, including the multi-line quoted ORACLE_CONFIGURATION block,
    and fall back to the process environment for anything it does not define.

    The file wins where both have a value. That ordering matters on a laptop,
    where a stray exported variable should not quietly outrank the file the
    developer is editing.
    """
    values: dict[str, str] = {}
    path = ROOT / ".env"

    if path.is_file():
        text = path.read_text(encoding="utf-8", errors="replace")
        for match in re.finditer(r'^([A-Za-z_][A-Za-z0-9_]*)="([^"]*)"', text, re.MULTILINE):
            values[match.group(1)] = match.group(2)
        for line in text.splitlines():
            key, sep, value = line.partition("=")
            key = key.strip()
            if sep and key and not key.startswith("#") and key not in values:
                values[key] = value.strip().strip("'\"")

    for key in CREDENTIAL_KEYS:
        if not values.get(key) and os.environ.get(key):
            values[key] = os.environ[key]
    return values


def fingerprint_of(pem: Path) -> str:
    from cryptography.hazmat.primitives import serialization

    key = serialization.load_pem_private_key(pem.read_bytes(), password=None)
    der = key.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    digest = hashlib.md5(der).hexdigest()  # noqa: S324 - OCI defines this as MD5
    return ":".join(digest[i : i + 2] for i in range(0, len(digest), 2))


def load_config() -> dict[str, str]:
    """Build an OCI config dict from the pasted console configuration."""
    values = read_env()
    block: dict[str, str] = {}
    for line in values.get("ORACLE_CONFIGURATION", "").splitlines():
        line = line.strip()
        if line and not line.startswith(("[", "#")):
            key, sep, value = line.partition("=")
            if sep:
                block[key.strip().lower()] = value.strip()

    if not block:
        raise SystemExit(
            "ORACLE_CONFIGURATION is missing. Put the block the OCI console "
            "gives you in .env, or pass it as an environment variable."
        )

    # The key may arrive as its own text rather than as a path to a file. That
    # is how a CI runner gets it: there is no ~/.oci to point at, and the
    # key_file line inside the block names a path on somebody's laptop.
    pem_text = values.get("ORACLE_API_KEY", "").strip()
    if pem_text:
        handle, name = tempfile.mkstemp(prefix="oci_api_key_", suffix=".pem")
        with os.fdopen(handle, "w", encoding="ascii") as stream:
            stream.write(pem_text + "\n")
        key_path = Path(name)
        key_path.chmod(0o600)
    else:
        # `~/.oci/...` is the conventional place for this key and the value the
        # console suggests, so expand it before anything else. A bare filename
        # is still resolved against the repository root, which is where a
        # freshly downloaded key tends to land.
        key_path = Path(block.get("key_file", "")).expanduser()
        if not key_path.is_absolute():
            for candidate in (ROOT / key_path, ROOT / key_path.name):
                if candidate.is_file():
                    key_path = candidate
                    break
        if not key_path.is_file():
            raise SystemExit(
                f"Oracle private key not found: {block.get('key_file')}\n"
                f"  resolved to: {key_path}"
            )

    return {
        "user": block["user"],
        "tenancy": block["tenancy"],
        "region": block["region"],
        "fingerprint": fingerprint_of(key_path),
        "key_file": str(key_path),
    }


def ssh_public_key() -> str:
    """
    The public half of the key baked into a new instance at launch.

    It can be supplied directly, which is what a CI runner does: the matching
    private key stays on the developer's machine, so a runner that provisions a
    host still cannot log into it.
    """
    supplied = read_env().get("ORACLE_SSH_PUBLIC_KEY", "").strip()
    if supplied:
        return supplied

    path = Path.home() / ".ssh" / "oracle_particle_wave.pub"
    if not path.is_file():
        raise SystemExit(
            f"SSH public key not found at {path}.\n"
            "  ssh-keygen -t ed25519 -f ~/.ssh/oracle_particle_wave -N ''"
        )
    return path.read_text(encoding="utf-8").strip()


# ──────────────────────────────────────────────────────────────────────────
# Resilience
# ──────────────────────────────────────────────────────────────────────────


def retry(call: Callable[[], T], *, tries: int = 5, delay: float = 3.0, what: str = "") -> T:
    """
    Call something, tolerating the transient 401/404s a young tenancy emits.

    Deliberately does *not* retry `LimitExceeded` or `OutOfCapacity`: those are
    real answers, and hammering them wastes minutes to reach the same place.
    """
    terminal = {"LimitExceeded", "QuotaExceeded", "OutOfHostCapacity"}
    last: Exception | None = None

    for index in range(tries):
        try:
            return call()
        except oci.exceptions.ServiceError as exc:
            if (exc.code or "") in terminal:
                raise
            last = exc
        except Exception as exc:  # noqa: BLE001 - network errors are retryable too
            last = exc
        if index + 1 < tries:
            time.sleep(delay)

    raise SystemExit(f"{what or 'OCI call'} failed after {tries} attempts: {last}")


def wait_until(
    fetch: Callable[[], Any],
    done: Callable[[Any], bool],
    *,
    label: str,
    timeout: float = 600,
    interval: float = 10,
) -> Any:
    """Poll until a resource reaches the wanted state, reporting as it goes."""
    deadline = time.monotonic() + timeout
    last_state = None

    while time.monotonic() < deadline:
        item = retry(fetch, what=f"polling {label}")
        state = getattr(item, "lifecycle_state", "?")
        if state != last_state:
            print(f"    {label}: {state}")
            last_state = state
        if done(item):
            return item
        time.sleep(interval)

    raise SystemExit(f"{label} did not become ready within {timeout:.0f}s")


def find(items: list, name: str):
    """First item with a matching display name, ignoring terminated ones."""
    for item in items:
        if getattr(item, "display_name", None) != name:
            continue
        state = getattr(item, "lifecycle_state", "")
        if state and state.upper().startswith("TERMINAT"):
            continue
        return item
    return None
