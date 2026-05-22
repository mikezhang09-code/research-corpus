from __future__ import annotations

import mimetypes
import re
from io import BytesIO
from typing import Any
from urllib.parse import quote
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.responses import HTMLResponse

from ..config import get_settings
from ..database import get_supabase
from ..models import (
    ChatHistoryResponse,
    ChatResponse,
    ChatTurn,
    GenerateDescriptionRequest,
    GenerateDescriptionResponse,
    LibraryChatRequest,
    LibraryFileContentUpdate,
    LibraryFileRead,
    LibraryFileUpdate,
    LibraryNotebookCreate,
    LibraryNotebookListResponse,
    LibraryNotebookRead,
    LibraryNotebookUpdate,
)
from ..repositories import library_notebooks as repo
from ..storage import delete_file, get_file_bytes, r2_key_for_upload, upload_file

router = APIRouter(prefix="/api/library-notebooks", tags=["library-notebooks"])

_CATEGORY_MAP: dict[str, str] = {
    ".ppt": "slide",
    ".pptx": "slide",
    ".key": "slide",
    ".odp": "slide",
    ".txt": "note",
    ".md": "note",
    ".docx": "report",
    ".doc": "report",
    ".pdf": "report",
    ".xlsx": "spreadsheet",
    ".xls": "spreadsheet",
    ".xlsm": "spreadsheet",
    ".csv": "spreadsheet",
    ".ods": "spreadsheet",
    ".mp3": "audio",
    ".m4a": "audio",
    ".wav": "audio",
    ".ogg": "audio",
    ".aac": "audio",
    ".mp4": "video",
    ".mov": "video",
    ".avi": "video",
    ".mkv": "video",
    ".webm": "video",
    ".json": "mindmap",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".gif": "image",
    ".webp": "image",
    ".svg": "image",
}


def _detect_category(ext: str) -> str:
    return _CATEGORY_MAP.get(ext.lower(), "other")


def _notebook_or_404(db, nb_id: UUID) -> dict:
    nb = repo.get(db, nb_id)
    if not nb:
        raise HTTPException(404, "Notebook not found")
    return nb


# MiMo's reasoning shows up in two places — as separate `thinking` /
# `reasoning` content blocks (Anthropic-style), and as inline `<think>...
# </think>` (or `<thinking>...</thinking>`) wrappers inside a regular text
# block. Strip both so only the final answer is shown to the user.
_REASONING_TAG_RE = re.compile(
    r"<(?:think|thinking|reasoning)>.*?</(?:think|thinking|reasoning)>",
    flags=re.DOTALL | re.IGNORECASE,
)
_REASONING_BLOCK_TYPES = {"thinking", "reasoning", "redacted_thinking"}


# ---------------------------------------------------------------------------
# File-text extraction for chat context
# ---------------------------------------------------------------------------

# Per-file truncation cap — keeps a single huge file from monopolising context.
_FILE_CHAR_CAP = 30_000
# Total cap across all files in one chat request. MiMo's context is generous
# but not unlimited; ~200k chars is roughly 50k tokens which leaves room for
# the conversation history and the model's reasoning.
_TOTAL_CHAR_CAP = 200_000
# Strip HTML tags without pulling in BeautifulSoup for one regex.
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_HTML_WHITESPACE_RE = re.compile(r"[ \t]+")
_HTML_NEWLINES_RE = re.compile(r"\n{3,}")


def _extract_file_text(file_row: dict) -> str | None:
    """Return plain-text contents for a library file, or None if not extractable.

    Best-effort across formats — text-bearing files get a real extraction,
    binary media (audio/video/images) return None so the prompt can list them
    as "(binary, not shown)" rather than crash.
    """
    if not file_row.get("r2_key"):
        return None
    ext = (file_row.get("file_ext") or "").lower()
    try:
        data = get_file_bytes(file_row["r2_key"])
    except Exception:
        return None

    try:
        if ext in (".md", ".txt"):
            return data.decode("utf-8", errors="replace")
        if ext == ".json":
            return data.decode("utf-8", errors="replace")
        if ext in (".html", ".htm"):
            text = data.decode("utf-8", errors="replace")
            text = _HTML_TAG_RE.sub(" ", text)
            text = _HTML_WHITESPACE_RE.sub(" ", text)
            return _HTML_NEWLINES_RE.sub("\n\n", text).strip()
        if ext in (".docx", ".doc"):
            import mammoth
            result = mammoth.extract_raw_text(BytesIO(data))
            return result.value
        if ext == ".pdf":
            import pypdf
            reader = pypdf.PdfReader(BytesIO(data))
            pages = []
            for i, page in enumerate(reader.pages, 1):
                try:
                    pages.append(f"--- page {i} ---\n{page.extract_text() or ''}")
                except Exception:
                    pages.append(f"--- page {i} (extraction failed) ---")
                if sum(len(p) for p in pages) > _FILE_CHAR_CAP:
                    break
            return "\n\n".join(pages)
        if ext in (".xlsx", ".xlsm", ".xls"):
            import openpyxl
            wb = openpyxl.load_workbook(BytesIO(data), read_only=True, data_only=True)
            chunks: list[str] = []
            for ws in wb.worksheets:
                chunks.append(f"=== sheet: {ws.title} ===")
                for row in ws.iter_rows(values_only=True):
                    cells = [str(c) if c is not None else "" for c in row]
                    if any(cells):
                        chunks.append("\t".join(cells))
                    if sum(len(c) for c in chunks) > _FILE_CHAR_CAP:
                        chunks.append("(truncated)")
                        return "\n".join(chunks)
            return "\n".join(chunks)
        if ext == ".csv":
            return data.decode("utf-8", errors="replace")
        # Best-effort utf-8 for unknown text-y files; binary returns garbage
        # but is rejected by the truncation step below.
        try:
            text = data.decode("utf-8")
            return text if text.isprintable() or "\n" in text else None
        except UnicodeDecodeError:
            return None
    except Exception:
        return None


def _build_files_context(files: list[dict]) -> str:
    """Format file contents for inclusion in the system prompt.

    Files exceeding _FILE_CHAR_CAP are truncated with a marker. Once the
    running total exceeds _TOTAL_CHAR_CAP, remaining files are listed by
    title only.
    """
    if not files:
        return "  (no files in this notebook)"
    sections: list[str] = []
    total = 0
    for f in files:
        title = f.get("title") or f.get("original_name", "Untitled")
        category = f.get("file_category", "file")
        header = f"=== FILE: {title}  [category: {category}] ==="

        if total >= _TOTAL_CHAR_CAP:
            sections.append(f"{header}\n(omitted — context budget reached)")
            continue

        text = _extract_file_text(f)
        if text is None:
            sections.append(f"{header}\n(binary or non-text — contents not shown)")
            continue
        text = text.strip()
        if not text:
            sections.append(f"{header}\n(empty)")
            continue
        if len(text) > _FILE_CHAR_CAP:
            text = text[:_FILE_CHAR_CAP] + f"\n…(truncated, full file is {len(text):,} chars)"
        # If even truncated this would blow the total budget, cut harder.
        remaining = _TOTAL_CHAR_CAP - total
        if len(text) > remaining:
            text = text[:remaining] + "\n…(truncated to fit total context budget)"
        sections.append(f"{header}\n{text}")
        total += len(text)
    return "\n\n".join(sections)


def _extract_answer(content: list[Any]) -> str:
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
    # Drop an unclosed reasoning block (truncated by max_tokens) so we don't
    # leak half a thought.
    open_tag = re.search(r"<(think|thinking|reasoning)>", joined, flags=re.IGNORECASE)
    if open_tag:
        joined = joined[: open_tag.start()]
    # Strip orphan closing tags left behind by malformed nesting.
    joined = re.sub(r"</(think|thinking|reasoning)>", "", joined, flags=re.IGNORECASE)
    return joined.strip()


def _enrich(nb: dict, file_count: int) -> dict:
    return {**nb, "file_count": file_count}


# ---------------------------------------------------------------------------
# Notebook CRUD
# ---------------------------------------------------------------------------


@router.get("", response_model=LibraryNotebookListResponse)
async def list_notebooks(
    include_hidden: bool = Query(False),
    tag: list[str] | None = Query(None),
):
    db = get_supabase()
    notebooks = repo.list_all(db, include_hidden=include_hidden, tags=tag)
    counts = repo.get_file_counts(db)
    items = [_enrich(nb, counts.get(nb["id"], 0)) for nb in notebooks]
    return {"items": items, "total": len(items)}


@router.post("", response_model=LibraryNotebookRead, status_code=201)
async def create_notebook(body: LibraryNotebookCreate):
    db = get_supabase()
    nb = repo.create(
        db, title=body.title, cover_emoji=body.cover_emoji, tags=body.tags or None
    )
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


@router.patch("/{nb_id}/files/{file_id}", response_model=LibraryFileRead)
async def update_notebook_file(nb_id: UUID, file_id: UUID, body: LibraryFileUpdate):
    """Rename or recategorise a file. Only fields present in the body are updated."""
    db = get_supabase()
    _notebook_or_404(db, nb_id)
    if not repo.get_file(db, nb_id, file_id):
        raise HTTPException(404, "File not found")
    patch: dict = {}
    if body.title is not None:
        title = body.title.strip()
        if not title:
            raise HTTPException(400, "title cannot be empty")
        patch["title"] = title
    if body.description is not None:
        patch["description"] = body.description
    if body.file_category is not None:
        patch["file_category"] = body.file_category.strip() or "other"
    row = repo.update_file(db, nb_id, file_id, patch)
    if not row:
        raise HTTPException(404, "File not found")
    return row


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

    # HTTP headers must be latin-1, so non-ASCII filenames (e.g. Chinese)
    # need RFC 5987 percent-encoding. Provide an ASCII-safe `filename=`
    # fallback for older clients alongside the canonical `filename*=`.
    ascii_fallback = original_name.encode("ascii", "ignore").decode() or "download"
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{ascii_fallback}"; '
                f"filename*=UTF-8''{quote(original_name, safe='')}"
            )
        },
    )


@router.put("/{nb_id}/files/{file_id}/content", response_model=LibraryFileRead)
async def update_notebook_file_content(nb_id: UUID, file_id: UUID, body: LibraryFileContentUpdate):
    """Overwrite a stored text file's contents (used by the note editor).

    The item keeps its `r2_key`/`r2_url` — only the bytes and `file_size_bytes`
    change, so the file card and viewers keep working unchanged.
    """
    db = get_supabase()
    _notebook_or_404(db, nb_id)
    f = repo.get_file(db, nb_id, file_id)
    if not f:
        raise HTTPException(404, "File not found")
    r2_key = f.get("r2_key")
    if not r2_key:
        raise HTTPException(400, "This item has no stored file to update")

    data = body.content.encode("utf-8")
    mime = f.get("mime_type") or "text/markdown"
    upload_file(r2_key, data, mime)
    row = repo.update_file(db, nb_id, file_id, {"file_size_bytes": len(data)})
    if not row:
        raise HTTPException(404, "File not found")
    return row


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


@router.delete("/{nb_id}/chat/history", status_code=204)
async def clear_chat_history(nb_id: UUID):
    """Wipe persisted chat history for this folio (used after saving a chat as a note)."""
    db = get_supabase()
    _notebook_or_404(db, nb_id)
    repo.clear_chat_history(db, nb_id)


@router.post("/{nb_id}/chat", response_model=ChatResponse)
async def chat(nb_id: UUID, body: LibraryChatRequest):
    db = get_supabase()
    nb = _notebook_or_404(db, nb_id)
    s = get_settings()

    if not s.anthropic_api_key:
        raise HTTPException(503, "ANTHROPIC_API_KEY is not configured")

    # Build system prompt from notebook context — including extracted text
    # from attached files so the model can actually answer from them. Heavy
    # files are truncated per-file and overall to fit the model's context
    # window; binary media (audio/video/images) get a placeholder line.
    files = repo.list_files(db, nb_id)
    files_context = _build_files_context(files)
    description = nb.get("description") or ""
    lang = (body.language or "en").lower()
    if lang == "zh":
        lang_directive = (
            "Always respond in Simplified Chinese (中文), regardless of the "
            "language used in the question or source materials."
        )
    else:
        lang_directive = (
            "Always respond in English, regardless of the language used in "
            "the question or source materials."
        )
    system_prompt = (
        f'You are an AI assistant for the research notebook "{nb["title"]}".\n'
        + (f"Notebook description: {description}\n\n" if description else "\n")
        + "The following files are attached to this notebook. Their extracted "
        "text appears below — treat it as the PRIMARY source for your answer. "
        "Some files may be truncated (very long PDFs, large spreadsheets) or "
        "shown as placeholders (audio/video/images, binary formats).\n\n"
        f"{files_context}\n\n"
        f"{lang_directive}\n\n"
        "Answer the user's question directly and substantively, in a single turn.\n"
        "Cite information from the files when you draw on them — name the file "
        "(e.g. \"per the 中科大.xlsx data…\"). If the files don't cover the "
        "question, fall back to your own general knowledge and say so explicitly.\n"
        'DO NOT say things like "let me check the files", "I\'ll look into", '
        '"please wait", or ask the user to provide more context — the file '
        "contents are already in this prompt and you have no tools."
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
    answer = _extract_answer(response.content)

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


@router.post("/{nb_id}/description/generate", response_model=GenerateDescriptionResponse)
async def generate_description(nb_id: UUID, body: GenerateDescriptionRequest):
    """Draft a short description for the folio from its title + file list.

    Does NOT persist — the frontend fills the textarea so the user can edit
    and Save manually.
    """
    db = get_supabase()
    nb = _notebook_or_404(db, nb_id)
    s = get_settings()
    if not s.anthropic_api_key:
        raise HTTPException(503, "ANTHROPIC_API_KEY is not configured")

    files = repo.list_files(db, nb_id)
    file_lines = (
        "\n".join(
            f"  - {f.get('title') or f.get('original_name', 'Untitled')} "
            f"({f.get('file_category', 'file')})"
            for f in files
        )
        or "  (no files yet)"
    )

    lang = (body.language or "en").lower()
    if lang == "zh":
        lang_directive = "Write the description in Simplified Chinese (中文)."
    else:
        lang_directive = "Write the description in English."

    system_prompt = (
        "You are an AI research librarian. Write a concise 2–3 sentence "
        "description for a research folio that summarises what kind of "
        "research or material it collects, based on its title and the file "
        "list. You only see file titles — not contents — so stay general; "
        "rely on the titles and categories.\n\n"
        f"{lang_directive}\n\n"
        "Return ONLY the description text. No preamble, no quotes, no "
        "markdown headers, no bullet points. Do not start with phrases like "
        '"This folio…", "Here is…", or "The notebook…".'
    )
    user_prompt = f"Folio title: {nb['title']}\n" f"Files:\n{file_lines}"

    import anthropic

    client = anthropic.AsyncAnthropic(
        api_key=s.anthropic_api_key,
        base_url=s.anthropic_base_url,
    )
    response = await client.messages.create(
        model=s.anthropic_model,
        max_tokens=s.anthropic_max_tokens,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )
    description = _extract_answer(response.content)
    # Strip any stray surrounding quotes the model might still add despite
    # the instruction.
    description = description.strip().strip('"').strip("'").strip()
    if not description:
        raise HTTPException(502, "Model returned an empty description")
    return GenerateDescriptionResponse(description=description)
