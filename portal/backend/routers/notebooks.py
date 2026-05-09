from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, HTTPException

from ..database import get_supabase
from ..models import LiveArtifact, LiveArtifactsResponse, NLMArtifactRead, NotebookRead

router = APIRouter(prefix="/api/notebooks", tags=["notebooks"])

_FORMAT_MAP: dict[str, str] = {
    "audio": "mp3",
    "video": "mp4",
    "report": "md",
    "quiz": "json",
    "flashcards": "json",
    "infographic": "png",
    "slide_deck": "pdf",
    "data_table": "csv",
    "mind_map": "json",
}


@router.get("", response_model=list[NotebookRead])
async def list_notebooks():
    db = get_supabase()
    rows = db.table("notebooks").select("*").order("last_synced_at", desc=True).execute().data
    return rows


@router.post("/sync", response_model=list[NotebookRead])
async def sync_notebooks():
    """Pull notebooks from NotebookLM API and upsert into Supabase."""
    try:
        from notebooklm import NotebookLMClient
    except ImportError:
        raise HTTPException(503, "notebooklm-py not available")

    db = get_supabase()

    async with await NotebookLMClient.from_storage() as client:
        notebooks = await client.notebooks.list()

    rows = [
        {
            "id": nb.id,
            "title": nb.title,
            "sources_count": nb.sources_count,
            "is_owner": nb.is_owner,
            "nlm_created_at": nb.created_at.isoformat() if nb.created_at else None,
        }
        for nb in notebooks
    ]

    if rows:
        db.table("notebooks").upsert(rows, on_conflict="id").execute()

    synced = db.table("notebooks").select("*").execute().data
    return synced


@router.get("/{notebook_id}", response_model=NotebookRead)
async def get_notebook(notebook_id: str):
    db = get_supabase()
    rows = db.table("notebooks").select("*").eq("id", notebook_id).execute().data
    if not rows:
        raise HTTPException(404, f"Notebook {notebook_id} not found")
    return rows[0]


@router.post("/{notebook_id}/sync-artifacts", response_model=list[NLMArtifactRead])
async def sync_notebook_artifacts(notebook_id: str):
    """Pull completed artifacts from NLM API for a notebook and upsert into Supabase."""
    try:
        from notebooklm import NotebookLMClient
    except ImportError:
        raise HTTPException(503, "notebooklm-py not available")

    db = get_supabase()

    # Resolve notebook title from local cache (best-effort)
    nb_rows = db.table("notebooks").select("title").eq("id", notebook_id).execute().data
    notebook_title = nb_rows[0]["title"] if nb_rows else None

    async with await NotebookLMClient.from_storage() as client:
        artifacts = await client.artifacts.list(notebook_id)

    rows = []
    for a in artifacts:
        kind = a.kind.value
        if kind == "unknown":
            continue
        fmt = _FORMAT_MAP.get(kind, "bin")
        rows.append({
            "nlm_artifact_id": a.id,
            "notebook_id": notebook_id,
            "notebook_title": notebook_title,
            "artifact_type": kind,
            "file_format": fmt,
            "title": a.title or kind,
            "nlm_created_at": a.created_at.isoformat() if a.created_at else None,
        })

    if rows:
        db.table("nlm_artifacts").upsert(rows, on_conflict="nlm_artifact_id").execute()

    synced = (
        db.table("nlm_artifacts")
        .select("*")
        .eq("notebook_id", notebook_id)
        .order("nlm_created_at", desc=True)
        .execute()
        .data
    )
    return synced


@router.get("/{notebook_id}/artifacts", response_model=list[NLMArtifactRead])
async def get_notebook_artifacts(notebook_id: str):
    db = get_supabase()
    rows = (
        db.table("nlm_artifacts")
        .select("*")
        .eq("notebook_id", notebook_id)
        .order("nlm_created_at", desc=True)
        .execute()
        .data
    )
    return rows


@router.get("/{notebook_id}/live-artifacts", response_model=LiveArtifactsResponse)
async def list_live_artifacts(notebook_id: str, background: BackgroundTasks):
    """Fetch artifacts live from NLM API, merged with portal save state from Supabase.

    Any artifact already registered (pending) but whose download was never
    triggered (downloaded_at IS NULL) is automatically re-queued here.
    """
    try:
        from notebooklm import NotebookLMClient
    except ImportError:
        raise HTTPException(503, "notebooklm-py not available")

    from ..tasks.downloader import download_artifact_to_r2

    db = get_supabase()

    nb_rows = db.table("notebooks").select("title").eq("id", notebook_id).execute().data
    notebook_title = nb_rows[0]["title"] if nb_rows else None

    async with await NotebookLMClient.from_storage() as client:
        nlm_artifacts = await client.artifacts.list(notebook_id)

    saved_rows = (
        db.table("nlm_artifacts").select("*").eq("notebook_id", notebook_id).execute().data
    )
    saved_map = {row["nlm_artifact_id"]: row for row in saved_rows}

    # Re-queue any stuck pending records (inserted by sync-artifacts but never downloaded)
    for row in saved_rows:
        if row["download_status"] == "pending" and not row.get("downloaded_at"):
            background.add_task(download_artifact_to_r2, UUID(row["id"]))

    artifacts: list[LiveArtifact] = []
    for a in nlm_artifacts:
        kind = a.kind.value
        if kind == "unknown":
            continue
        fmt = _FORMAT_MAP.get(kind, "bin")
        saved = saved_map.get(a.id)
        artifacts.append(
            LiveArtifact(
                nlm_id=a.id,
                title=a.title or kind,
                artifact_type=kind,
                file_format=fmt,
                created_at=a.created_at,
                is_completed=a.is_completed,
                portal_id=saved["id"] if saved else None,
                download_status=saved["download_status"] if saved else None,
                r2_url=saved.get("r2_url") if saved else None,
                download_error=saved.get("download_error") if saved else None,
            )
        )

    return LiveArtifactsResponse(
        notebook_id=notebook_id,
        notebook_title=notebook_title,
        artifacts=artifacts,
    )
