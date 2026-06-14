"""AI assistant for Mermaid diagram artifacts.

Stateless helper: takes a natural-language instruction plus the current
Mermaid source and returns updated Mermaid. When a ``notebook_id`` (folio) is
supplied, the folio's files are folded into the prompt so edits are grounded
in the research context. Reuses the shared ``ai_chat`` helper (MiMo primary,
Gemini fallback) — no diagram state is persisted here; the frontend owns the
document.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..ai import ai_chat
from ..config import get_settings
from ..diagram_utils import ASSIST_SYSTEM, split_mermaid

router = APIRouter(prefix="/api/diagrams", tags=["diagrams"])


class DiagramAssistRequest(BaseModel):
    prompt: str
    current: str = ""
    notebook_id: str | None = None  # folio id → ground edits in its files


class DiagramAssistResponse(BaseModel):
    mermaid: str
    explanation: str


def _folio_context(notebook_id: str) -> str:
    """Folio title + file contents block, or '' if unavailable.

    Imported lazily to avoid a circular import between routers.
    """
    from uuid import UUID

    from ..database import get_supabase
    from . import library_notebooks as lib

    try:
        db = get_supabase()
        nb = lib._notebook_or_404(db, UUID(notebook_id))
        files = lib.repo.list_files(db, UUID(notebook_id))
    except Exception:
        return ""
    if not files:
        return ""
    return (
        f'The user is working inside the research folio "{nb["title"]}". Its '
        "files appear below — ground the diagram in them; do not invent facts "
        "they don't support.\n\n" + lib._build_files_context(files)
    )


@router.post("/assist", response_model=DiagramAssistResponse)
async def assist(req: DiagramAssistRequest) -> DiagramAssistResponse:
    prompt = req.prompt.strip()
    if not prompt:
        raise HTTPException(400, "prompt is required")

    s = get_settings()
    current = req.current.strip()

    system = ASSIST_SYSTEM
    if req.notebook_id:
        context = _folio_context(req.notebook_id)
        if context:
            system = f"{ASSIST_SYSTEM}\n\n{context}"

    user = (
        f"Current Mermaid source:\n```mermaid\n{current}\n```\n\n"
        if current
        else "There is no diagram yet.\n\n"
    ) + f"Instruction: {prompt}"

    try:
        raw = await ai_chat(system, [{"role": "user", "content": user}], s)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc

    mermaid, explanation = split_mermaid(raw)
    if not mermaid:
        raise HTTPException(502, "AI returned no diagram")
    return DiagramAssistResponse(mermaid=mermaid, explanation=explanation)
