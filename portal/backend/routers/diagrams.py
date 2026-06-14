"""AI assistant for the Mermaid diagram studio.

Stateless helper: takes a natural-language instruction plus the current
Mermaid source and returns updated Mermaid. Reuses the shared ``ai_chat``
helper (MiMo primary, Gemini fallback) — no diagram state is persisted here;
the frontend owns the document.
"""

from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..ai import ai_chat
from ..config import get_settings

router = APIRouter(prefix="/api/diagrams", tags=["diagrams"])


class DiagramAssistRequest(BaseModel):
    prompt: str
    current: str = ""


class DiagramAssistResponse(BaseModel):
    mermaid: str
    explanation: str


_SYSTEM = """You are a Mermaid diagram assistant embedded in a diagram editor.

The user gives an instruction and the current Mermaid source (which may be \
empty). Return the COMPLETE updated Mermaid document — never a partial diff.

Hard rules:
- Reply with exactly one fenced code block: ```mermaid ... ``` containing the \
full diagram, and nothing before it except an optional single short sentence \
of explanation.
- Output valid Mermaid 11 syntax. Quote node labels that contain spaces or \
punctuation, e.g. A["Sign in"].
- Preserve the user's existing structure and labels unless they ask to change \
them; apply only the requested edit.
- If the current source is empty, create a sensible new diagram for the \
request (default to `flowchart TD` unless another type fits better).
- Do not use emoji or exotic glyphs in labels.
- Never wrap the diagram in extra prose, markdown headings, or multiple code \
blocks."""

_FENCE = re.compile(r"```(?:mermaid)?\s*\n(.*?)```", re.DOTALL | re.IGNORECASE)


def _split(answer: str) -> tuple[str, str]:
    """Extract (mermaid, explanation) from the model reply."""
    match = _FENCE.search(answer)
    if match:
        mermaid = match.group(1).strip()
        explanation = (answer[: match.start()] + answer[match.end() :]).strip()
        return mermaid, explanation
    # No fence — assume the whole reply is the diagram.
    return answer.strip(), ""


@router.post("/assist", response_model=DiagramAssistResponse)
async def assist(req: DiagramAssistRequest) -> DiagramAssistResponse:
    prompt = req.prompt.strip()
    if not prompt:
        raise HTTPException(400, "prompt is required")

    s = get_settings()
    current = req.current.strip()
    user = (
        f"Current Mermaid source:\n```mermaid\n{current}\n```\n\n"
        if current
        else "There is no diagram yet.\n\n"
    ) + f"Instruction: {prompt}"

    try:
        raw = await ai_chat(_SYSTEM, [{"role": "user", "content": user}], s)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc

    mermaid, explanation = _split(raw)
    if not mermaid:
        raise HTTPException(502, "AI returned no diagram")
    return DiagramAssistResponse(mermaid=mermaid, explanation=explanation)
