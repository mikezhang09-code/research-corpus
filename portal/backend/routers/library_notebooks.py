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
from ..diagram_utils import (
    GENERATE_INSTRUCTIONS as _DIAGRAM_GEN_INSTRUCTIONS,
)
from ..diagram_utils import (
    diagram_title,
    split_mermaid,
)
from ..models import (
    ChatHistoryResponse,
    ChatResponse,
    ChatTurn,
    GenerateArtifactRequest,
    GenerateDescriptionRequest,
    GenerateDescriptionResponse,
    LibraryChatRequest,
    LibraryFileBulkRequest,
    LibraryFileContentUpdate,
    LibraryFileRead,
    LibraryFilesNewNotebookRequest,
    LibraryFileUpdate,
    LibraryNotebookCreate,
    LibraryNotebookListResponse,
    LibraryNotebookRead,
    LibraryNotebookUpdate,
    PushFileResult,
    PushToCorpusRequest,
    PushToCorpusResponse,
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
    ".md": "report",
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
    ".mmd": "diagram",
    ".jsx": "component",
    ".tsx": "component",
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
        if ext in (".md", ".txt", ".mmd"):
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
    nb = repo.create(db, title=body.title, cover_emoji=body.cover_emoji, tags=body.tags or None)
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
    nb = repo.get(db, nb_id) if not patch else repo.update(db, nb_id, patch)
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


@router.post("/{nb_id}/files/bulk-delete", status_code=204)
async def bulk_delete_notebook_files(nb_id: UUID, body: LibraryFileBulkRequest):
    db = get_supabase()
    _notebook_or_404(db, nb_id)
    if not body.file_ids:
        return

    wanted = {str(fid) for fid in body.file_ids}
    files = [f for f in repo.list_files(db, nb_id) if str(f.get("id")) in wanted]
    if len(files) != len(wanted):
        raise HTTPException(404, "One or more files were not found")

    for f in files:
        if f.get("r2_key"):
            try:
                delete_file(f["r2_key"])
            except Exception:
                pass
        repo.delete_file(db, nb_id, UUID(str(f["id"])))


@router.post(
    "/{nb_id}/files/move-to-new-notebook", response_model=LibraryNotebookRead, status_code=201
)
async def move_files_to_new_notebook(nb_id: UUID, body: LibraryFilesNewNotebookRequest):
    db = get_supabase()
    _notebook_or_404(db, nb_id)
    title = body.title.strip()
    if not title:
        raise HTTPException(400, "title is required")
    if not body.file_ids:
        raise HTTPException(400, "file_ids is required")

    wanted = {str(fid) for fid in body.file_ids}
    files = [f for f in repo.list_files(db, nb_id) if str(f.get("id")) in wanted]
    if len(files) != len(wanted):
        raise HTTPException(404, "One or more files were not found")

    nb = repo.create(db, title=title, cover_emoji=body.cover_emoji, tags=body.tags or None)
    moved = repo.move_files(db, nb_id, body.file_ids, UUID(str(nb["id"])))
    return _enrich(nb, len(moved))


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


def file_content_response(f: dict, format: str | None = None) -> Response:
    """Build the content response for a stored library file.

    Shared by the folio file endpoint and the free-forms router.
    """
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


@router.get("/{nb_id}/files/{file_id}/content")
async def get_file_content(nb_id: UUID, file_id: UUID, format: str | None = Query(None)):
    db = get_supabase()
    f = repo.get_file(db, nb_id, file_id)
    if not f:
        raise HTTPException(404, "File not found")
    return file_content_response(f, format)


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


@router.put("/{nb_id}/files/{file_id}/file", response_model=LibraryFileRead)
async def replace_notebook_file_bytes(nb_id: UUID, file_id: UUID, file: UploadFile = File(...)):
    """Overwrite a stored file's bytes in place (used by the docx editor).

    The item keeps its `r2_key`/`r2_url` and metadata — only the bytes and
    `file_size_bytes` change, so cards and viewers keep working unchanged.
    """
    db = get_supabase()
    _notebook_or_404(db, nb_id)
    f = repo.get_file(db, nb_id, file_id)
    if not f:
        raise HTTPException(404, "File not found")
    r2_key = f.get("r2_key")
    if not r2_key:
        raise HTTPException(400, "This item has no stored file to update")

    data = await file.read()
    mime = f.get("mime_type") or file.content_type or "application/octet-stream"
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
        '(e.g. "per the 中科大.xlsx data…"). If the files don\'t cover the '
        "question, fall back to your own general knowledge and say so explicitly.\n"
        'DO NOT say things like "let me check the files", "I\'ll look into", '
        '"please wait", or ask the user to provide more context — the file '
        "contents are already in this prompt and you have no tools."
    )

    # Fetch prior turns as conversation history
    history = repo.get_chat_history(db, nb_id, limit=40)
    messages = [{"role": h["role"], "content": h["content"]} for h in history]
    messages.append({"role": "user", "content": body.message})

    from ..ai import ai_chat

    try:
        answer = await ai_chat(system_prompt, messages, s)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))

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


# ---------------------------------------------------------------------------
# AI artifact generation
# ---------------------------------------------------------------------------

_GEN_KINDS = ("note", "mindmap", "quiz", "flashcards", "diagram")

# Per-kind output instructions. JSON kinds carry a "title" field that is
# stripped before saving so the stored file is exactly the shape the
# corresponding viewer/editor reads (mirrors the public viewer's generate
# route in portal/public).
_GEN_INSTRUCTIONS: dict[str, str] = {
    "note": (
        "Write a synthesis note in Markdown that distils the key ideas across ALL the "
        "files above: the main themes, how the pieces relate, and any open questions. "
        'Start with a single "# <title>" heading on the first line (a short, specific '
        "title), then well-structured sections. Output ONLY the Markdown — no preamble, "
        "no code fence."
    ),
    "mindmap": (
        "Produce a mind map of the source material as STRICT JSON (no code fence, no "
        "commentary) in exactly this shape:\n"
        '{"title": "<short file title>", "name": "<central topic>", '
        '"children": [{"name": "...", "children": [...]}]}\n'
        'Aim for 3-6 main branches and 2-4 levels of depth. "children" may be omitted '
        "on leaves."
    ),
    "quiz": (
        "Produce a multiple-choice quiz covering the most important points of the "
        "source material as STRICT JSON (no code fence, no commentary) in exactly this "
        "shape:\n"
        '{"title": "<short quiz title>", "questions": [{"question": "...", "hint": "...", '
        '"answerOptions": [{"text": "...", "rationale": "why right/wrong", "isCorrect": true}]}]}\n'
        "Write 6-10 questions, each with exactly 4 answer options and exactly one "
        "isCorrect: true. Every option needs a rationale. The hint is optional but "
        "encouraged."
    ),
    "flashcards": (
        "Produce study flashcards covering the key facts and concepts of the source "
        "material as STRICT JSON (no code fence, no commentary) in exactly this shape:\n"
        '{"title": "<short deck title>", "cards": [{"front": "question or term", '
        '"back": "answer or definition"}]}\n'
        "Write 12-20 cards. Fronts should be specific prompts, backs concise but complete."
    ),
    "diagram": _DIAGRAM_GEN_INSTRUCTIONS,
}


def _extract_json_object(text: str) -> dict:
    import json

    stripped = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.IGNORECASE)
    stripped = re.sub(r"```\s*$", "", stripped)
    # The model may wrap the object in prose (or append commentary after it),
    # so try each "{" and let raw_decode stop at the end of the first complete
    # object instead of slicing first-"{" .. last-"}".
    decoder = json.JSONDecoder()
    idx = stripped.find("{")
    while idx >= 0:
        try:
            parsed, _ = decoder.raw_decode(stripped, idx)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, dict):
            return parsed
        idx = stripped.find("{", idx + 1)
    raise ValueError("model response contained no JSON object")


def _clean_mindmap_node(raw: Any, depth: int = 0) -> dict | None:
    if depth > 6 or not isinstance(raw, dict):
        return None
    name = str(raw.get("name") or "").strip()
    if not name:
        return None
    children = [
        node
        for c in (raw.get("children") or [])
        if (node := _clean_mindmap_node(c, depth + 1)) is not None
    ]
    return {"name": name, "children": children} if children else {"name": name}


def _build_generated_artifact(kind: str, raw: str) -> tuple[str, str, str, str]:
    """Validate model output for `kind` → (title, content, ext, mime).

    Raises ValueError with a user-presentable message on malformed output.
    """
    import json

    if kind == "note":
        heading = re.search(r"^#\s+(.+)$", raw, flags=re.MULTILINE)
        title = (heading.group(1) if heading else "Generated note").strip()
        return title, raw, ".md", "text/markdown"

    if kind == "diagram":
        mermaid, _ = split_mermaid(raw)
        if not mermaid:
            raise ValueError("model returned no diagram")
        return diagram_title(mermaid), mermaid, ".mmd", "text/vnd.mermaid"

    obj = _extract_json_object(raw)
    title = str(obj.get("title") or "").strip() or f"Generated {kind}"

    if kind == "mindmap":
        root = _clean_mindmap_node({"name": obj.get("name"), "children": obj.get("children")})
        if not root or not root.get("children"):
            raise ValueError("model returned an empty mind map")
        return title, json.dumps(root, ensure_ascii=False, indent=2), ".json", "application/json"

    if kind == "quiz":
        questions = []
        for q in obj.get("questions") or []:
            if not isinstance(q, dict):
                continue
            opts = [
                {
                    "text": str(o.get("text") or "").strip(),
                    "rationale": str(o.get("rationale") or "").strip(),
                    "isCorrect": bool(o.get("isCorrect")),
                }
                for o in (q.get("answerOptions") or [])
                if isinstance(o, dict) and str(o.get("text") or "").strip()
            ]
            question = str(q.get("question") or "").strip()
            hint = str(q.get("hint") or "").strip()
            if question and len(opts) >= 2 and any(o["isCorrect"] for o in opts):
                questions.append(
                    {
                        "question": question,
                        **({"hint": hint} if hint else {}),
                        "answerOptions": opts,
                    }
                )
        if not questions:
            raise ValueError("model returned no valid quiz questions")
        return (
            title,
            json.dumps({"questions": questions}, ensure_ascii=False, indent=2),
            ".json",
            "application/json",
        )

    # flashcards
    cards = [
        {"front": str(c.get("front") or "").strip(), "back": str(c.get("back") or "").strip()}
        for c in (obj.get("cards") or [])
        if isinstance(c, dict)
    ]
    cards = [c for c in cards if c["front"] and c["back"]]
    if not cards:
        raise ValueError("model returned no valid flashcards")
    return (
        title,
        json.dumps({"cards": cards}, ensure_ascii=False, indent=2),
        ".json",
        "application/json",
    )


@router.post("/{nb_id}/generate", response_model=LibraryFileRead, status_code=201)
async def generate_artifact(nb_id: UUID, body: GenerateArtifactRequest):
    """Generate a new artifact with AI, using the folio's files as context.

    The result is stored exactly like a manual upload so every viewer/editor
    opens it unchanged.
    """
    kind = body.kind
    if kind not in _GEN_KINDS:
        raise HTTPException(400, f"kind must be one of: {', '.join(_GEN_KINDS)}")

    db = get_supabase()
    nb = _notebook_or_404(db, nb_id)
    s = get_settings()

    files = repo.list_files(db, nb_id)
    if not files:
        raise HTTPException(400, "This folio has no files to use as context — add some first.")
    files_context = _build_files_context(files)

    lang = (body.language or "en").lower()
    if lang == "zh":
        lang_directive = "Write the artifact in Simplified Chinese (中文)."
    else:
        lang_directive = "Write the artifact in English."

    system_prompt = (
        "You are generating a study artifact for a personal research portal.\n"
        f'The artifact is based on the research folio "{nb["title"]}". The folio\'s '
        "files appear below — base your output ONLY on them; do not invent facts "
        "they don't support. Some files may be truncated or shown as placeholders.\n\n"
        f"{files_context}\n\n"
        f"{lang_directive}"
    )

    from ..ai import ai_chat

    # Repeat the language directive in the user turn — with a large files
    # context the tail of the system prompt can get under-weighted.
    user_prompt = f"{_GEN_INSTRUCTIONS[kind]}\n\n{lang_directive}"

    try:
        raw = await ai_chat(system_prompt, [{"role": "user", "content": user_prompt}], s)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))

    try:
        title, content, ext, mime = _build_generated_artifact(kind, raw)
    except ValueError as exc:  # includes json.JSONDecodeError
        raise HTTPException(502, f"Generation failed: {exc}")

    from datetime import datetime, timezone

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S")
    filename = f"{kind}-{stamp}{ext}"
    item_id = str(uuid4())
    data = content.encode("utf-8")
    r2_key = r2_key_for_upload(item_id, filename)
    r2_url_val = upload_file(r2_key, data, mime)

    row = {
        "id": item_id,
        "title": title,
        "description": f"Generated by AI from {len(files)} folio file(s)",
        "source_type": "upload",
        "original_name": filename,
        "mime_type": mime,
        "file_ext": ext,
        "file_category": kind,
        "r2_key": r2_key,
        "r2_url": r2_url_val,
        "file_size_bytes": len(data),
        "is_link_only": False,
        "tags": [],
        "notebook_id": str(nb_id),
    }
    return db.table("library_items").insert(row).execute().data[0]


@router.post("/{nb_id}/description/generate", response_model=GenerateDescriptionResponse)
async def generate_description(nb_id: UUID, body: GenerateDescriptionRequest):
    """Draft a short description for the folio from its title + file list.

    Does NOT persist — the frontend fills the textarea so the user can edit
    and Save manually.
    """
    db = get_supabase()
    nb = _notebook_or_404(db, nb_id)
    s = get_settings()

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
    user_prompt = f"Folio title: {nb['title']}\nFiles:\n{file_lines}"

    from ..ai import ai_chat

    try:
        description = await ai_chat(system_prompt, [{"role": "user", "content": user_prompt}], s)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))

    # Strip any stray surrounding quotes the model might still add despite
    # the instruction.
    description = description.strip().strip('"').strip("'").strip()
    if not description:
        raise HTTPException(502, "Model returned an empty description")
    return GenerateDescriptionResponse(description=description)


# ---------------------------------------------------------------------------
# Push folio files → NotebookLM notebook (one-way copy; folio is untouched)
# ---------------------------------------------------------------------------

# Folio categories NotebookLM accepts as uploaded sources. Everything else
# (video, spreadsheet, mindmap/json, diagram/mmd, quiz/flashcards, component)
# has no NotebookLM source type and is reported as skipped.
_NLM_SOURCE_CATEGORIES = frozenset({"report", "note", "slide", "image", "audio"})

# Human-readable skip reasons by category, for the per-file results list.
_SKIP_REASONS: dict[str, str] = {
    "video": "Video files are not a NotebookLM source type",
    "spreadsheet": "Spreadsheets are not a NotebookLM source type (convert to PDF/text first)",
    "mindmap": "Mind maps are portal-native (no NotebookLM source type)",
    "diagram": "Diagrams are portal-native (no NotebookLM source type)",
    "quiz": "Quizzes are portal-native (no NotebookLM source type)",
    "flashcards": "Flashcards are portal-native (no NotebookLM source type)",
    "component": "Components are portal-native (no NotebookLM source type)",
}


async def _push_file_to_notebook(client, notebook_id: str, f: dict) -> PushFileResult:
    """Route a single folio file to the right NotebookLM source-add call.

    Link-only items go through add_url; supported uploads are streamed from R2
    to a temp file and registered via add_file. Anything else is skipped with a
    reason. Per-file failures are caught so one bad file doesn't abort the batch.
    """
    import shutil
    import tempfile
    from pathlib import Path

    file_id = UUID(str(f["id"]))
    title = f.get("title") or f.get("original_name") or "Untitled"
    category = f.get("file_category") or "other"

    # Link-only folio items → URL source.
    if f.get("is_link_only") and f.get("external_url"):
        try:
            source = await client.sources.add_url(notebook_id, f["external_url"])
        except Exception as exc:
            return PushFileResult(file_id=file_id, title=title, status="error", reason=str(exc))
        return PushFileResult(file_id=file_id, title=title, status="pushed", source_id=source.id)

    if category not in _NLM_SOURCE_CATEGORIES:
        reason = _SKIP_REASONS.get(category, "File type is not a NotebookLM source type")
        return PushFileResult(file_id=file_id, title=title, status="skipped", reason=reason)

    if not f.get("r2_key"):
        return PushFileResult(
            file_id=file_id, title=title, status="skipped", reason="File has no stored content"
        )

    # Download from R2 and replay through NotebookLM's resumable upload, keeping
    # the original filename so NotebookLM displays it (and detects type) correctly.
    original_name = Path(f.get("original_name") or title).name or "upload"
    tmp_dir = tempfile.mkdtemp()
    tmp_path = Path(tmp_dir) / original_name
    try:
        data = get_file_bytes(f["r2_key"])
        tmp_path.write_bytes(data)
        source = await client.sources.add_file(notebook_id, str(tmp_path))
    except Exception as exc:
        return PushFileResult(file_id=file_id, title=title, status="error", reason=str(exc))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
    return PushFileResult(file_id=file_id, title=title, status="pushed", source_id=source.id)


@router.post("/{nb_id}/push-to-corpus", response_model=PushToCorpusResponse)
async def push_to_corpus(nb_id: UUID, body: PushToCorpusRequest):
    """Push selected folio files into a NotebookLM notebook as sources.

    Copy, not move: the folio and its files are left untouched. Target an
    existing notebook via `target_notebook_id`, or omit it to create a new one
    (then `new_title` is required). Returns a per-file result list so the caller
    can show exactly what was pushed vs. skipped.
    """
    from datetime import datetime, timezone

    db = get_supabase()
    _notebook_or_404(db, nb_id)

    if not body.file_ids:
        raise HTTPException(400, "file_ids is required")

    # Validate every requested file belongs to this folio (mirrors bulk-delete).
    wanted = {str(fid) for fid in body.file_ids}
    files = [f for f in repo.list_files(db, nb_id) if str(f.get("id")) in wanted]
    if len(files) != len(wanted):
        raise HTTPException(404, "One or more files were not found")

    if not body.target_notebook_id and not (body.new_title and body.new_title.strip()):
        raise HTTPException(400, "Provide target_notebook_id or new_title")

    try:
        from notebooklm import NotebookLMClient
    except ImportError:
        raise HTTPException(503, "notebooklm-py not available")

    # A folio file may need fetching + server-side processing per source; the
    # default 30s RPC timeout is too tight for a batch, so widen it (matches the
    # research-import endpoint).
    async with await NotebookLMClient.from_storage(timeout=180.0) as client:
        # Resolve target notebook (create-new or existing).
        if body.target_notebook_id:
            notebook_id = body.target_notebook_id
            nb_rows = db.table("notebooks").select("title").eq("id", notebook_id).execute().data
            if not nb_rows:
                raise HTTPException(404, f"Notebook {notebook_id} not found")
            notebook_title = nb_rows[0]["title"]
        else:
            try:
                nb = await client.notebooks.create(body.new_title.strip())  # type: ignore[union-attr]
            except Exception as exc:
                raise HTTPException(502, f"NotebookLM create failed: {exc}")
            notebook_id = nb.id
            notebook_title = nb.title
            db.table("notebooks").upsert(
                {
                    "id": nb.id,
                    "title": nb.title,
                    "sources_count": nb.sources_count,
                    "is_owner": nb.is_owner,
                    "nlm_created_at": nb.created_at.isoformat() if nb.created_at else None,
                    "last_synced_at": datetime.now(timezone.utc).isoformat(),
                    "cover_emoji": body.new_cover_emoji,
                },
                on_conflict="id",
            ).execute()

        # Push files sequentially — keeps NotebookLM's upload pipeline from being
        # hammered and makes per-file error attribution straightforward.
        results = [await _push_file_to_notebook(client, notebook_id, f) for f in files]

    return PushToCorpusResponse(
        notebook_id=notebook_id,
        notebook_title=notebook_title,
        results=results,
    )
