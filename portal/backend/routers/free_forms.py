from __future__ import annotations

import mimetypes
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile

from ..database import get_supabase
from ..models import FreeFormFileRead, FreeFormFileUpdate, LibraryFileContentUpdate
from ..repositories import library as repo
from ..storage import delete_file, r2_key_for_upload, upload_file
from .library_notebooks import _detect_category, file_content_response

router = APIRouter(prefix="/api/free-forms", tags=["free-forms"])


def _file_or_404(db, file_id: UUID) -> dict:
    f = repo.get_free(db, file_id)
    if not f:
        raise HTTPException(404, "File not found")
    return f


@router.get("", response_model=list[FreeFormFileRead])
async def list_files(
    category: str | None = Query(None),
    tag: str | None = Query(None),
    search: str | None = Query(None),
):
    db = get_supabase()
    return repo.list_free(db, category=category, tag=tag, search=search)


@router.post("/upload", response_model=FreeFormFileRead, status_code=201)
async def upload_free_form_file(
    file: UploadFile = File(...),
    category: str = Form(""),
    title: str = Form(""),
    tags: str = Form(""),  # comma-separated
):
    db = get_supabase()

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
        "tags": [t.strip() for t in tags.split(",") if t.strip()],
        "notebook_id": None,
    }
    return db.table("library_items").insert(row).execute().data[0]


@router.patch("/{file_id}", response_model=FreeFormFileRead)
async def update_free_form_file(file_id: UUID, body: FreeFormFileUpdate):
    """Rename, recategorise, or retag a file. Only fields present are updated."""
    db = get_supabase()
    _file_or_404(db, file_id)
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
    if body.tags is not None:
        patch["tags"] = [t.strip() for t in body.tags if t.strip()]
    row = repo.update_free(db, file_id, patch)
    if not row:
        raise HTTPException(404, "File not found")
    return row


@router.delete("/{file_id}", status_code=204)
async def delete_free_form_file(file_id: UUID):
    db = get_supabase()
    f = _file_or_404(db, file_id)
    if f.get("r2_key"):
        try:
            delete_file(f["r2_key"])
        except Exception:
            pass
    repo.delete_free(db, file_id)


@router.get("/{file_id}/content")
async def get_free_form_file_content(file_id: UUID, format: str | None = Query(None)):
    db = get_supabase()
    f = _file_or_404(db, file_id)
    return file_content_response(f, format)


@router.put("/{file_id}/content", response_model=FreeFormFileRead)
async def update_free_form_file_content(file_id: UUID, body: LibraryFileContentUpdate):
    """Overwrite a stored text file's contents (used by the note editor).

    The item keeps its `r2_key`/`r2_url` — only the bytes and `file_size_bytes`
    change, so the table row and viewers keep working unchanged.
    """
    db = get_supabase()
    f = _file_or_404(db, file_id)
    r2_key = f.get("r2_key")
    if not r2_key:
        raise HTTPException(400, "This item has no stored file to update")

    data = body.content.encode("utf-8")
    mime = f.get("mime_type") or "text/markdown"
    upload_file(r2_key, data, mime)
    row = repo.update_free(db, file_id, {"file_size_bytes": len(data)})
    if not row:
        raise HTTPException(404, "File not found")
    return row
