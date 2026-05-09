from __future__ import annotations

import mimetypes
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile

from ..database import get_supabase
from ..models import (
    LibraryFilters,
    LibraryItemCreate,
    LibraryItemListResponse,
    LibraryItemRead,
    LibraryItemUpdate,
    LibrarySourceType,
)
from ..repositories import library as repo
from ..storage import delete_file, r2_key_for_upload, upload_file

router = APIRouter(prefix="/api/library", tags=["library"])


def _filters(
    source_type: str | None = None,
    file_ext: str | None = None,
    collection: str | None = None,
    tag: str | None = None,
    search: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> LibraryFilters:
    return LibraryFilters(
        source_type=source_type,
        file_ext=file_ext,
        collection=collection,
        tag=tag,
        search=search,
        limit=limit,
        offset=offset,
    )


@router.get("", response_model=LibraryItemListResponse)
async def list_items(filters: LibraryFilters = Depends(_filters)):
    db = get_supabase()
    items, total = repo.list_all(db, filters)
    return {"items": items, "total": total}


@router.post("/upload", response_model=LibraryItemRead, status_code=201)
async def upload_file_endpoint(
    file: UploadFile = File(...),
    title: str = Form(""),
    description: str = Form(""),
    tags: str = Form(""),           # comma-separated
    collection: str = Form(""),
):
    data = await file.read()
    item_id = str(uuid4())
    filename = file.filename or "upload"
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    mime = file.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    key = r2_key_for_upload(item_id, filename)
    url = upload_file(key, data, mime)

    tag_list = [t.strip() for t in tags.split(",") if t.strip()]

    db = get_supabase()
    row = repo.create(
        db,
        LibraryItemCreate(
            title=title or filename,
            description=description,
            source_type=LibrarySourceType.UPLOAD,
            original_name=filename,
            mime_type=mime,
            file_ext=ext,
            tags=tag_list,
            collection=collection or None,
        ),
        r2_key=key,
        r2_url=url,
        file_size_bytes=len(data),
    )
    return row


@router.post("/link", response_model=LibraryItemRead, status_code=201)
async def add_link(data: LibraryItemCreate):
    """Add a YouTube link or web URL without uploading a file."""
    if data.source_type not in (LibrarySourceType.YOUTUBE_LINK, LibrarySourceType.WEB_LINK):
        raise HTTPException(400, "Use /upload for files; /link for URLs only")
    db = get_supabase()
    return repo.create(db, data)


@router.get("/collections", response_model=list[str])
async def list_collections():
    return repo.list_collections(get_supabase())


@router.get("/{item_id}", response_model=LibraryItemRead)
async def get_item(item_id: UUID):
    db = get_supabase()
    row = repo.get(db, item_id)
    if not row:
        raise HTTPException(404, "Item not found")
    return row


@router.patch("/{item_id}", response_model=LibraryItemRead)
async def update_item(item_id: UUID, data: LibraryItemUpdate):
    db = get_supabase()
    row = repo.update(db, item_id, data)
    if not row:
        raise HTTPException(404, "Item not found")
    return row


@router.delete("/{item_id}", status_code=204)
async def delete_item(item_id: UUID):
    db = get_supabase()
    row = repo.get(db, item_id)
    if not row:
        raise HTTPException(404, "Item not found")
    if row.get("r2_key"):
        delete_file(row["r2_key"])
    repo.delete(db, item_id)
