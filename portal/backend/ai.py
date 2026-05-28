"""Centralised AI helper — MiMo primary, Gemini fallback.

Every AI call in the portal backend should go through :func:`ai_chat` so
that callers get automatic failover without duplicating retry logic.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from .config import Settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# MiMo reasoning-tag stripping (moved here so both providers share cleanup)
# ---------------------------------------------------------------------------

_REASONING_TAG_RE = re.compile(
    r"<(?:think|thinking|reasoning)>.*?</(?:think|thinking|reasoning)>",
    flags=re.DOTALL | re.IGNORECASE,
)
_REASONING_BLOCK_TYPES = {"thinking", "reasoning", "redacted_thinking"}


def strip_reasoning(content: list[Any]) -> str:
    """Extract the final answer from Anthropic-style content blocks.

    MiMo wraps its chain-of-thought in ``<think>`` tags and/or separate
    ``thinking`` content blocks.  This strips both so only the user-facing
    answer remains.
    """
    parts: list[str] = []
    for block in content:
        btype = getattr(block, "type", None)
        if btype in _REASONING_BLOCK_TYPES:
            continue
        if btype == "text":
            text = getattr(block, "text", "") or ""
            if text:
                parts.append(text)
    joined = "".join(parts)
    # Strip nested/repeated reasoning wrappers by re-applying until stable.
    for _ in range(4):
        new = _REASONING_TAG_RE.sub("", joined)
        if new == joined:
            break
        joined = new
    # Drop an unclosed reasoning block (truncated by max_tokens).
    open_tag = re.search(r"<(think|thinking|reasoning)>", joined, flags=re.IGNORECASE)
    if open_tag:
        joined = joined[: open_tag.start()]
    # Strip orphan closing tags left behind by malformed nesting.
    joined = re.sub(r"</(think|thinking|reasoning)>", "", joined, flags=re.IGNORECASE)
    return joined.strip()


# ---------------------------------------------------------------------------
# Provider implementations
# ---------------------------------------------------------------------------


async def _call_mimo(
    system: str,
    messages: list[dict[str, str]],
    settings: Settings,
) -> str:
    """Call Xiaomi MiMo via the Anthropic-compatible SDK."""
    import anthropic

    client = anthropic.AsyncAnthropic(
        api_key=settings.anthropic_api_key,
        base_url=settings.anthropic_base_url,
    )
    response = await client.messages.create(
        model=settings.anthropic_model,
        max_tokens=settings.anthropic_max_tokens,
        system=system,
        messages=messages,
    )
    return strip_reasoning(response.content)


async def _call_gemini(
    system: str,
    messages: list[dict[str, str]],
    settings: Settings,
) -> str:
    """Call Google Gemini via the google-genai SDK."""
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=settings.gemini_api_key)

    # Convert Anthropic-style messages to Gemini Content objects.
    contents: list[types.Content] = []
    for msg in messages:
        role = "user" if msg["role"] == "user" else "model"
        contents.append(types.Content(role=role, parts=[types.Part(text=msg["content"])]))

    response = await client.aio.models.generate_content(
        model=settings.gemini_model,
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=system,
        ),
    )
    return (response.text or "").strip()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def ai_chat(
    system: str,
    messages: list[dict[str, str]],
    settings: Settings,
) -> str:
    """Send a chat request — tries MiMo first, falls back to Gemini.

    Raises :class:`RuntimeError` only if *both* providers fail (or neither
    is configured).
    """
    errors: list[str] = []

    # 1. Try MiMo (primary)
    if settings.anthropic_api_key:
        try:
            answer = await _call_mimo(system, messages, settings)
            if answer:
                logger.debug("AI response from MiMo (%s)", settings.anthropic_model)
                return answer
            errors.append("MiMo returned empty response")
        except Exception as exc:
            logger.warning("MiMo failed (%s: %s), trying Gemini fallback", type(exc).__name__, exc)
            errors.append(f"MiMo: {exc}")

    # 2. Fallback: Gemini
    if settings.gemini_api_key:
        try:
            answer = await _call_gemini(system, messages, settings)
            if answer:
                logger.info("AI response from Gemini fallback (%s)", settings.gemini_model)
                return answer
            errors.append("Gemini returned empty response")
        except Exception as exc:
            logger.error("Gemini fallback also failed: %s", exc)
            errors.append(f"Gemini: {exc}")

    # Both failed (or neither is configured)
    detail = "; ".join(errors) if errors else "No AI provider configured (set ANTHROPIC_API_KEY and/or GEMINI_API_KEY)"
    raise RuntimeError(f"All AI providers failed — {detail}")
