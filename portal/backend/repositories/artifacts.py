from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from supabase import Client

from ..models import ArtifactFilters, DownloadStatus, NLMArtifactCreate, NLMArtifactUpdate

TABLE = "nlm_artifacts"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create(db: Client, data: NLMArtifactCreate) -> dict:
    row = data.model_dump(mode="json", exclude_none=True)
    return db.table(TABLE).insert(row).execute().data[0]


def get(db: Client, artifact_id: UUID) -> dict | None:
    rows = db.table(TABLE).select("*").eq("id", str(artifact_id)).execute().data
    return rows[0] if rows else None


def list_all(db: Client, filters: ArtifactFilters) -> tuple[list[dict], int]:
    q = db.table(TABLE).select("*", count="exact")
    if filters.artifact_type:
        q = q.eq("artifact_type", filters.artifact_type)
    if filters.download_status:
        q = q.eq("download_status", filters.download_status)
    if filters.notebook_id:
        q = q.eq("notebook_id", filters.notebook_id)
    if filters.tag:
        q = q.contains("tags", [filters.tag])
    if filters.search:
        q = q.ilike("title", f"%{filters.search}%")
    q = q.order("portal_added_at", desc=True).range(
        filters.offset, filters.offset + filters.limit - 1
    )
    resp = q.execute()
    return resp.data, resp.count or 0


def update(db: Client, artifact_id: UUID, data: NLMArtifactUpdate) -> dict | None:
    patch = {k: v for k, v in data.model_dump(mode="json").items() if v is not None}
    if not patch:
        return get(db, artifact_id)
    rows = db.table(TABLE).update(patch).eq("id", str(artifact_id)).execute().data
    return rows[0] if rows else None


def update_download_status(
    db: Client,
    artifact_id: UUID,
    status: DownloadStatus,
    *,
    r2_key: str | None = None,
    r2_url: str | None = None,
    file_size_bytes: int | None = None,
    error: str | None = None,
) -> None:
    patch: dict = {"download_status": status.value}
    if status == DownloadStatus.DONE:
        patch["downloaded_at"] = _now()
        patch["r2_key"] = r2_key
        patch["r2_url"] = r2_url
        patch["file_size_bytes"] = file_size_bytes
        patch["download_error"] = ""  # clear stale error from a prior failed attempt
    if status == DownloadStatus.FAILED:
        patch["download_error"] = error
    if status in (DownloadStatus.GENERATING, DownloadStatus.PENDING, DownloadStatus.DOWNLOADING):
        patch["download_error"] = ""
    db.table(TABLE).update(patch).eq("id", str(artifact_id)).execute()


def delete(db: Client, artifact_id: UUID) -> None:
    db.table(TABLE).delete().eq("id", str(artifact_id)).execute()


def set_library_item(db: Client, artifact_id: UUID, library_item_id: UUID) -> None:
    db.table(TABLE).update({"library_item_id": str(library_item_id)}).eq(
        "id", str(artifact_id)
    ).execute()


def upsert_from_nlm(db: Client, data: NLMArtifactCreate) -> dict:
    row = data.model_dump(mode="json", exclude_none=True)
    return db.table(TABLE).upsert(row, on_conflict="nlm_artifact_id").execute().data[0]
