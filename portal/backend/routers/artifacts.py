from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import Response

from ..database import get_supabase
from ..models import (
    ArtifactFilters,
    DownloadStatus,
    NLMArtifactCreate,
    NLMArtifactListResponse,
    NLMArtifactRead,
    NLMArtifactUpdate,
)
from ..repositories import artifacts as repo
from ..tasks.downloader import download_artifact_to_r2

router = APIRouter(prefix="/api/artifacts", tags=["artifacts"])


def _filters(
    artifact_type: str | None = None,
    download_status: str | None = None,
    notebook_id: str | None = None,
    tag: str | None = None,
    search: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> ArtifactFilters:
    return ArtifactFilters(
        artifact_type=artifact_type,
        download_status=download_status,
        notebook_id=notebook_id,
        tag=tag,
        search=search,
        limit=limit,
        offset=offset,
    )


@router.get("", response_model=NLMArtifactListResponse)
async def list_artifacts(filters: ArtifactFilters = Depends(_filters)):
    db = get_supabase()
    items, total = repo.list_all(db, filters)
    return {"items": items, "total": total}


@router.post("", response_model=NLMArtifactRead, status_code=201)
async def register_artifact(data: NLMArtifactCreate, background: BackgroundTasks):
    db = get_supabase()
    row = repo.upsert_from_nlm(db, data)
    artifact_id = UUID(row["id"])
    background.add_task(download_artifact_to_r2, artifact_id)
    return row


@router.get("/{artifact_id}", response_model=NLMArtifactRead)
async def get_artifact(artifact_id: UUID):
    db = get_supabase()
    row = repo.get(db, artifact_id)
    if not row:
        raise HTTPException(404, "Artifact not found")
    return row


@router.patch("/{artifact_id}", response_model=NLMArtifactRead)
async def update_artifact(artifact_id: UUID, data: NLMArtifactUpdate):
    db = get_supabase()
    row = repo.update(db, artifact_id, data)
    if not row:
        raise HTTPException(404, "Artifact not found")
    return row


@router.delete("/{artifact_id}", status_code=204)
async def delete_artifact(artifact_id: UUID):
    db = get_supabase()
    row = repo.get(db, artifact_id)
    if not row:
        raise HTTPException(404, "Artifact not found")
    if row.get("r2_key"):
        from ..storage import delete_file

        delete_file(row["r2_key"])
    repo.delete(db, artifact_id)


@router.post("/{artifact_id}/retry-download", response_model=NLMArtifactRead)
async def retry_download(artifact_id: UUID, background: BackgroundTasks):
    db = get_supabase()
    row = repo.get(db, artifact_id)
    if not row:
        raise HTTPException(404, "Artifact not found")
    repo.update_download_status(db, artifact_id, DownloadStatus.PENDING)
    background.add_task(download_artifact_to_r2, artifact_id)
    return repo.get(db, artifact_id)


@router.get("/{artifact_id}/content")
async def get_artifact_content(artifact_id: UUID):
    """Stream the raw file bytes from R2 so the browser fetches via the same-origin proxy."""
    from ..storage import get_r2, get_settings

    db = get_supabase()
    row = repo.get(db, artifact_id)
    if not row:
        raise HTTPException(404, "Artifact not found")
    if not row.get("r2_key"):
        raise HTTPException(404, "File not yet downloaded")

    s = get_settings()
    obj = get_r2().get_object(Bucket=s.r2_bucket_name, Key=row["r2_key"])
    data = obj["Body"].read()
    fmt = row.get("file_format", "bin")
    mime_map = {
        "md": "text/plain; charset=utf-8",
        "json": "application/json; charset=utf-8",
        "csv": "text/csv; charset=utf-8",
        "pdf": "application/pdf",
        "png": "image/png",
        "mp3": "audio/mpeg",
        "mp4": "video/mp4",
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "html": "text/html; charset=utf-8",
    }
    content_type = mime_map.get(fmt, "application/octet-stream")
    return Response(content=data, media_type=content_type)


@router.post("/{artifact_id}/save-to-library", status_code=201)
async def save_to_library(artifact_id: UUID):
    """Copy a downloaded NLM artifact into the Library section."""
    import boto3

    from ..config import get_settings
    from ..models import LibraryItemCreate, LibrarySourceType
    from ..repositories import library as lib_repo
    from ..storage import r2_key_for_upload, upload_file

    db = get_supabase()
    row = repo.get(db, artifact_id)
    if not row:
        raise HTTPException(404, "Artifact not found")
    if row["download_status"] != DownloadStatus.DONE.value:
        raise HTTPException(400, "Artifact must be downloaded before saving to library")
    if row.get("library_item_id"):
        raise HTTPException(409, "Already saved to library")

    s = get_settings()
    r2 = boto3.client(
        "s3",
        endpoint_url=s.r2_endpoint_url,
        aws_access_key_id=s.r2_access_key_id,
        aws_secret_access_key=s.r2_secret_access_key,
        region_name="auto",
    )

    # Read from R2 and write to library path
    obj = r2.get_object(Bucket=s.r2_bucket_name, Key=row["r2_key"])
    data = obj["Body"].read()
    filename = f"{row['title'] or row['artifact_type']}.{row['file_format']}"
    import uuid

    item_id = str(uuid.uuid4())
    new_key = r2_key_for_upload(item_id, filename)
    new_url = upload_file(new_key, data, obj.get("ContentType", "application/octet-stream"))

    item = lib_repo.create(
        db,
        LibraryItemCreate(
            title=row["title"] or row["artifact_type"],
            source_type=LibrarySourceType.UPLOAD,
            original_name=filename,
            file_ext=f".{row['file_format']}",
            tags=row.get("tags", []),
        ),
        r2_key=new_key,
        r2_url=new_url,
        file_size_bytes=len(data),
    )
    repo.set_library_item(db, artifact_id, UUID(item["id"]))
    return {"library_item_id": item["id"]}
