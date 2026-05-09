from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..database import get_supabase
from ..models import NotebookRead

router = APIRouter(prefix="/api/notebooks", tags=["notebooks"])


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
