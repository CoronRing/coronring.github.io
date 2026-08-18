"""
Request and response models.

The wire contract is deliberately small. A chat request is a question plus the
transcript so far; everything else — which model, which key, whether the answer
came from cache — is the server's business and is *reported* rather than
accepted. Nothing a client sends may influence routing, because a client that
could name its model could exhaust the best one on purpose.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .settings import settings


class Message(BaseModel):
    """One prior turn of the conversation, as the client remembers it."""

    role: Literal["user", "assistant"]
    content: str = Field(max_length=8_000)


class ChatRequest(BaseModel):
    """A question, with optional prior context."""

    message: str = Field(
        min_length=1,
        max_length=settings.max_question_chars,
        description="The visitor's question.",
    )
    history: list[Message] = Field(
        default_factory=list,
        max_length=64,
        description=(
            "Prior turns, oldest first. Trimmed server-side to the configured "
            "budget; the client is not trusted to have kept it small."
        ),
    )
    stream: bool = Field(
        default=True,
        description="Stream the answer as server-sent events rather than one JSON body.",
    )


class Citation(BaseModel):
    """A page the answer drew on."""

    route: str
    title: str
    url: str


class ChatResponse(BaseModel):
    """A complete answer, for non-streaming clients."""

    answer: str
    citations: list[Citation] = Field(default_factory=list)
    model: str = Field(description="Model that produced the answer.")
    cached: bool = Field(
        default=False, description="Served from the local answer cache, with no upstream call."
    )
    degraded: bool = Field(
        default=False,
        description="Produced by a fallback model because the preferred ones were unavailable.",
    )
    corpus_hash: str = Field(description="Identity of the site text the answer came from.")
    elapsed_ms: int = 0
