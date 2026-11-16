"""
Sending mail, with `smtplib` and nothing else.

The two services next door hand-write their provider clients rather than pull
an SDK onto a free-tier ARM box, and this follows them. A mailing-list send is
an SMTP session and a `multipart/alternative` message; the standard library
does both, and the nearest library that would do it for us drags an agent
framework in behind it.

## The headers that matter

Every message carries `List-Unsubscribe` and `List-Unsubscribe-Post`. Those
are what put a one-click unsubscribe in the reader's mail client, above the
message, where it is far easier to reach than a link in a footer. A reader who
cannot find the way out reports the mail as spam instead, and a spam report
costs the sending address far more than a lost subscriber does.

`List-Unsubscribe` is given twice over, as a URL and as a mailto, because
clients differ on which they will honour.
"""

from __future__ import annotations

import smtplib
import ssl
from collections.abc import Iterator
from contextlib import contextmanager
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid

from .settings import settings


class MailError(Exception):
    """The mailbox refused a message or could not be reached."""


def build(
    *,
    to: str,
    subject: str,
    text: str,
    html: str,
    unsubscribe_url: str | None = None,
) -> EmailMessage:
    """Assemble one message.

    Args:
        to: The one recipient. Every send is its own message, so no reader
            ever sees another reader's address.
        subject: Subject line.
        text: Plain-text body, shown by clients that prefer it.
        html: HTML body.
        unsubscribe_url: This reader's own unsubscribe link, which becomes
            both the footer link already in `html` and the `List-Unsubscribe`
            header here.

    Returns:
        A ready-to-send `multipart/alternative` message.
    """
    message = EmailMessage()
    message["From"] = formataddr((settings.mail_from_name, settings.sender))
    message["To"] = to
    message["Subject"] = subject
    message["Date"] = formatdate(localtime=True)
    message["Message-ID"] = make_msgid()
    if settings.mail_reply_to:
        message["Reply-To"] = settings.mail_reply_to
    if unsubscribe_url:
        message["List-Unsubscribe"] = (
            f"<{unsubscribe_url}>, <mailto:{settings.sender}?subject=unsubscribe>"
        )
        # Without this header a client shows the link but will not act on it
        # itself, which turns one tap into a page load the reader may abandon.
        message["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    message.set_content(text)
    message.add_alternative(html, subtype="html")
    return message


@contextmanager
def connection() -> Iterator[smtplib.SMTP]:
    """One authenticated SMTP session, reused for a whole broadcast.

    Opening a session per message would make a fifty-reader send fifty TLS
    handshakes and fifty logins, which is both slow and exactly the shape a
    provider throttles.
    """
    if not settings.mailbox_ready:
        raise MailError("the mailbox is not configured")
    context = ssl.create_default_context()
    try:
        if settings.smtp_port == 465:
            client: smtplib.SMTP = smtplib.SMTP_SSL(
                settings.smtp_host, settings.smtp_port, timeout=30, context=context
            )
        else:
            client = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30)
            client.ehlo()
            client.starttls(context=context)
            client.ehlo()
        client.login(settings.smtp_user, settings.smtp_password)
    except (OSError, smtplib.SMTPException) as exc:
        # The type alone: an SMTP error can quote the credential it rejected.
        raise MailError(f"could not reach the mailbox ({type(exc).__name__})") from exc
    try:
        yield client
    finally:
        try:
            client.quit()
        except (OSError, smtplib.SMTPException):
            pass


def send_one(message: EmailMessage) -> None:
    """Send a single message in its own session. For confirmations."""
    with connection() as client:
        try:
            client.send_message(message)
        except smtplib.SMTPException as exc:
            raise MailError(f"the mailbox refused the message ({type(exc).__name__})") from exc
