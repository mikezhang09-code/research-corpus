from __future__ import annotations

import mimetypes
from io import BytesIO
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.responses import HTMLResponse

from ..config import get_settings
from ..database import get_supabase
from ..models import (
    ChatHistoryResponse,
    ChatResponse,
    ChatTurn,
    LibraryChatRequest,
    LibraryFileRead,
    LibraryNotebookCreate,
    LibraryNotebookListResponse,
    LibraryNotebookRead,
    LibraryNotebookUpdate,
)
from ..repositories import library_notebooks as repo
from ..storage import delete_file, get_file_bytes, public_url, r2_key_for_upload, upload_file

router = APIRouter(prefix="/api/library-notebooks", tags=["library-notebooks"])

_CATEGORY_MAP: dict[str, str] = {
    ".ppt": "slide", ".pptx": "slide", ".key": "slide", ".odp": "slide",
    ".txt": "note", ".md": "note",
    ".docx": "report", ".doc": "report", ".pdf": "report",
    ".mp3": "audio", ".m4a": "audio", ".wav": "audio", ".ogg": "audio", ".aac": "audio",
    ".mp4": "video", ".mov": "video", ".avi": "video", ".mkv": "video", ".webm": "video",
    ".json": "mindmap",
    ".png": "image", ".jpg": "image", ".jpeg": "image",
    ".gif": "image", ".webp": "image", ".svg": "image",
}


def _detect_category(ext: str) -> str:
    return _CATEGORY_MAP.get(ext.lower(), "other")


def _notebook_or_404(db, nb_id: UUID) -> dict:
    nb = repo.get(db, nb_id)
    if not nb:
        raise HTTPException(404, "Notebook not found")
    return nb


def _enrich(nb: dict, file_count: int) -> dict:
    return {**nb, "file_count": file_count}


# ---------------------------------------------------------------------------
# Notebook CRUD
# ---------------------------------------------------------------------------

@router.get("", response_model=LibraryNotebookListResponse)
async def list_notebooks(include_hidden: bool = Query(False)):
    db = get_supabase()
    notebooks = repo.list_all(db, include_hidden=include_hidden)
    counts = repo.get_file_counts(db)
    items = [_enrich(nb, counts.get(nb["id"], 0)) for nb in notebooks]
    return {"items": items, "total": len(items)}


@router.post("", response_model=LibraryNotebookRead, status_code=201)
async def create_notebook(body: LibraryNotebookCreate):
    db = get_supabase()
    nb = repo.create(db, title=body.title, cover_emoji=body.cover_emoji)
    return _enrich(nb, 0)


@router.get("/{nb_id}", response_model=LibraryNotebookRead)
async def get_notebook(nb_id: UUID):
    db = get_supabase()
    nb = _notebook_or_404(db, nb_id)
    count = repo.get_file_count(db, nb_id)
    return _enrich(nb, count)


@router.patch("/{nb_id}", response_model=LibraryNotebookRead)
async def update_notebook(nb_id: UUID, body: LibraryNotebookUpdate):
    db = get_supabase()
    _notebook_or_404(db, nb_id)
    patch = body.model_dump(exclude_none=True)
    if not patch:
        nb = repo.get(db, nb_id)
    else:
        nb = repo.update(db, nb_id, patch)
    count = repo.get_file_count(db, nb_id)
    return _enrich(nb, count)


@router.delete("/{nb_id}", status_code=204)
async def delete_notebook(nb_id: UUID):
    db = get_supabase()
    _notebook_or_404(db, nb_id)
    # Delete R2 files for all items in this notebook before DB cascade
    files = repo.list_files(db, nb_id)
    for f in files:
        if f.get("r2_key"):
            try:
                delete_file(f["r2_key"])
            except Exception:
                pass
    repo.delete(db, nb_id)


@router.post("/{nb_id}/hide", response_model=LibraryNotebookRead)
async def hide_notebook(nb_id: UUID):
    db = get_supabase()
    _notebook_or_404(db, nb_id)
    nb = repo.hide(db, nb_id)
    count = repo.get_file_count(db, nb_id)
    return _enrich(nb, count)


@router.post("/{nb_id}/restore", response_model=LibraryNotebookRead)
async def restore_notebook(nb_id: UUID):
    db = get_supabase()
    _notebook_or_404(db, nb_id)
    nb = repo.restore(db, nb_id)
    count = repo.get_file_count(db, nb_id)
    return _enrich(nb, count)


# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------

@router.get("/{nb_id}/files", response_model=list[LibraryFileRead])
async def list_files(nb_id: UUID, category: str | None = Query(None)):
    db = get_supabase()
    _notebook_or_404(db, nb_id)
    return repo.list_files(db, nb_id, category=category)


@router.post("/{nb_id}/files/upload", response_model=LibraryFileRead, status_code=201)
async def upload_notebook_file(
    nb_id: UUID,
    file: UploadFile = File(...),
    category: str = Form(""),
    title: str = Form(""),
):
    db = get_supabase()
    _notebook_or_404(db, nb_id)

    data = await file.read()
    filename = file.filename or "upload"
    item_id = str(uuid4())
    ext = ("." + filename.rsplit(".", 1)[-1]) if "." in filename else ""
    detected_category = category.strip() if category.strip() else _detect_category(ext)
    mime = file.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"

    r2_key = r2_key_for_upload(item_id, filename)
    r2_url_val = upload_file(r2_key, data, mime)

    row = {
        "id": item_id,
        "title": title.strip() or filename,
        "description": "",
        "source_type": "upload",
        "original_name": filename,
        "mime_type": mime,
        "file_ext": ext or None,
        "file_category": detected_category,
        "r2_key": r2_key,
        "r2_url": r2_url_val,
        "file_size_bytes": len(data),
        "is_link_only": False,
        "tags": [],
        "notebook_id": str(nb_id),
    }
    result = db.table("library_items").insert(row).execute().data[0]
    return result


@router.delete("/{nb_id}/files/{file_id}", status_code=204)
async def delete_notebook_file(nb_id: UUID, file_id: UUID):
    db = get_supabase()
    _notebook_or_404(db, nb_id)
    f = repo.get_file(db, nb_id, file_id)
    if not f:
        raise HTTPException(404, "File not found")
    if f.get("r2_key"):
        try:
            delete_file(f["r2_key"])
        except Exception:
            pass
    repo.delete_file(db, nb_id, file_id)


@router.get("/{nb_id}/files/{file_id}/content")
async def get_file_content(nb_id: UUID, file_id: UUID, format: str | None = Query(None)):
    db = get_supabase()
    f = repo.get_file(db, nb_id, file_id)
    if not f:
        raise HTTPException(404, "File not found")
    if not f.get("r2_key"):
        raise HTTPException(404, "No file stored for this item")

    data = get_file_bytes(f["r2_key"])
    ext = (f.get("file_ext") or "").lower()
    original_name = f.get("original_name", "file")

    if ext in (".md", ".txt"):
        return Response(content=data, media_type="text/plain; charset=utf-8")

    if ext == ".docx" and format == "html":
        import mammoth  # lazy import — only installed if used
        result = mammoth.convert_to_html(BytesIO(data))
        return HTMLResponse(content=result.value)

    if ext == ".json":
        return Response(content=data, media_type="application/json")

    mime = f.get("mime_type") or "application/octet-stream"
    if mime.startswith("image/"):
        return Response(content=data, media_type=mime)

    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{original_name}"'},
    )


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

@router.get("/{nb_id}/chat/history", response_model=ChatHistoryResponse)
async def chat_history(nb_id: UUID):
    db = get_supabase()
    _notebook_or_404(db, nb_id)
    turns_raw = repo.get_chat_history(db, nb_id)

    # Pair up user/assistant turns into ChatTurn objects
    turns: list[ChatTurn] = []
    i = 0
    while i + 1 < len(turns_raw):
        u = turns_raw[i]
        a = turns_raw[i + 1]
        if u["role"] == "user" and a["role"] == "assistant":
            turns.append(ChatTurn(question=u["content"], answer=a["content"]))
            i += 2
        else:
            i += 1

    return ChatHistoryResponse(turns=turns, conversation_id=str(nb_id))


@router.post("/{nb_id}/chat", response_model=ChatResponse)
async def chat(nb_id: UUID, body: LibraryChatRequest):
    db = get_supabase()
    nb = _notebook_or_404(db, nb_id)
    s = get_settings()

    if not s.anthropic_api_key:
        raise HTTPException(503, "ANTHROPIC_API_KEY is not configured")

    # Build system prompt from notebook context
    files = repo.list_files(db, nb_id)
    file_lines = "\n".join(
        f"  - {f.get('title') or f.get('original_name', 'Untitled')} ({f.get('file_category', 'file')})"
        for f in files
    ) or "  (no files yet)"
    description = nb.get("description") or ""
    system_prompt = (
        f'You are an AI assistant for the library notebook "{nb["title"]}".\n'
        + (f"Description: {description}\n" if description else "")
        + f"Files in this notebook:\n{file_lines}\n\n"
        "Answer questions based on the context of this notebook. "
        "Be concise and helpful."
    )

    # Fetch prior turns as conversation history
    history = repo.get_chat_history(db, nb_id, limit=40)
    messages = [{"role": h["role"], "content": h["content"]} for h in history]
    messages.append({"role": "user", "content": body.message})

    import anthropic  # lazy import

    client = anthropic.AsyncAnthropic(
        api_key=s.anthropic_api_key,
        base_url=s.anthropic_base_url,
    )
    response = await client.messages.create(
        model=s.anthropic_model,
        max_tokens=s.anthropic_max_tokens,
        system=system_prompt,
        messages=messages,
    )
    # MiMo may emit `thinking` blocks alongside `text` — pick the first text block.
    answer = next(
        (b.text for b in response.content if getattr(b, "type", None) == "text"),
        "",
    )

    # Persist both turns
    repo.append_chat(db, nb_id, "user", body.message)
    repo.append_chat(db, nb_id, "assistant", answer)

    turn_number = len(history) // 2 + 1
    return ChatResponse(
        answer=answer,
        conversation_id=str(nb_id),
        turn_number=turn_number,
        is_follow_up=turn_number > 1,
        references=[],
    )
