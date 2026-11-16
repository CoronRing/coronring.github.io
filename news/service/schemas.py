"""Request and response shapes. Validation that matters is in `security.py`."""

from __future__ import annotations

from pydantic import BaseModel, Field


class SubscribeRequest(BaseModel):
    """A signup from the site's form."""

    email: str = Field(max_length=320)

    website: str = Field(default="", max_length=200)
    """
    Honeypot. The form renders it off-screen with no label, so a person never
    fills it in and a form-filling bot almost always does. A request carrying
    anything here is answered exactly like a good one and quietly dropped,
    because telling a bot it was spotted only improves the next bot.
    """

    source: str = Field(default="site", max_length=40)
    """Which surface the signup came from, for the operator's own curiosity."""


class SubscribeResponse(BaseModel):
    """Deliberately uninformative.

    The same body comes back for a new address, an address already on the
    list, one in its cooldown window, and one that tripped the honeypot. An
    endpoint that distinguishes them is an endpoint that will tell a stranger
    whether a given person reads this digest.
    """

    status: str
    """`pending` in every ordinary case, `full` when the list is closed."""

    message: str


class BroadcastRequest(BaseModel):
    """The signal from the NewsRing workflow that a digest is published."""

    date: str = Field(default="", max_length=20)
    """
    The date the caller believes was published. Checked against the date in
    the fetched message; a mismatch means the site has not finished deploying
    and the send is refused rather than sending yesterday's digest.
    """


class BroadcastResponse(BaseModel):
    """Counts only. Who is on the list never crosses this boundary."""

    date: str
    sent: int
    skipped: int
    failed: int
