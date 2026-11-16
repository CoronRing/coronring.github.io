"""
The one message this service writes itself: the confirmation.

Every other email it sends is NewsRing's, fetched whole. This one has to be
written here because it exists before a reader is on the list.

It is kept plain on purpose. A confirmation that arrives looking like
marketing gets deleted; one that looks like a receipt gets clicked. It says
who it is from, what was asked for, what happens next, and what to do if the
reader did not ask — which is nothing, because nothing has been stored.
"""

from __future__ import annotations

from html import escape

#: Inline styles only, in one light theme, for the same reason NewsRing's own
#: email template uses them: clients ignore `<style>` and colour-scheme hints.
_WRAP = (
    "max-width:560px;margin:0 auto;padding:24px 16px;"
    "font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;"
    "color:#191919;font-size:16px;line-height:1.6;"
)
_BRAND = (
    "font-family:Archivo,Helvetica,Arial,sans-serif;"
    "font-weight:800;font-size:20px;color:#191919;"
)
_BUTTON = (
    "display:inline-block;background:#0a0a0b;color:#fffa00;"
    "font-family:Consolas,Menlo,monospace;font-weight:700;font-size:14px;"
    "padding:12px 16px;text-decoration:none;margin:18px 0;"
)
_MUTED = "color:#5c5c5c;font-size:14px;"
_FOOT = "font-family:Consolas,Menlo,monospace;font-size:11px;color:#8a8a8a;margin-top:24px;"

SUBJECT = "Confirm your NewsRing subscription"


def confirmation_text(confirm_url: str) -> str:
    """The plain-text body."""
    return (
        "Confirm your NewsRing subscription\n\n"
        "Someone asked for the NewsRing daily AI digest to be sent to this "
        "address. Open this link and today's digest arrives straight away:\n\n"
        f"{confirm_url}\n\n"
        "One email a morning. The same digest goes to everyone, and every one "
        "of them has an unsubscribe link at the foot.\n\n"
        "If you did not ask for this, ignore this message. Your address has "
        "not been stored and nothing further will be sent.\n"
    )


def confirmation_html(confirm_url: str) -> str:
    """The HTML body."""
    safe = escape(confirm_url, quote=True)
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<meta name="color-scheme" content="light">'
        f"<title>{escape(SUBJECT)}</title></head>"
        '<body style="margin:0;padding:0;background:#f2f2f2;">'
        f'<div style="{_WRAP}">'
        f'<div style="{_BRAND}">NewsRing</div>'
        '<p style="margin:20px 0 0;">Someone asked for the NewsRing daily AI digest to be '
        "sent to this address. Open the link and today's digest arrives straight away.</p>"
        f'<a href="{safe}" style="{_BUTTON}">Confirm and send today’s digest</a>'
        f'<p style="{_MUTED}">One email a morning. The same digest goes to everyone, and '
        "every one of them has an unsubscribe link at the foot.</p>"
        f'<p style="{_MUTED}">If you did not ask for this, ignore this message. Your address '
        "has not been stored and nothing further will be sent.</p>"
        f'<div style="{_FOOT}">If the button does not work, paste this into your browser:<br>'
        f"{escape(confirm_url)}</div>"
        "</div></body></html>"
    )
