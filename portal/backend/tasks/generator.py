from __future__ import annotations

import logging
from uuid import UUID

logger = logging.getLogger(__name__)


async def generate_then_download(
    notebook_id: str,
    task_id: str,
    portal_id: UUID,
    artifact_type: str,
) -> None:
    """Background task: wait for NotebookLM to finish generating, then download to R2.

    Flow:
        generating → (NLM completes) → pending → downloading → done
                  └→ (NLM fails or times out) → failed
    """
    from ..database import get_supabase
    from ..models import DownloadStatus
    from ..repositories import artifacts as repo
    from .downloader import download_artifact_to_r2

    db = get_supabase()

    # Cinematic video can take ~30 minutes; everything else fits in 10.
    timeout = 1800.0 if artifact_type == "video" else 600.0

    try:
        from notebooklm import NotebookLMClient

        async with await NotebookLMClient.from_storage() as client:
            result = await client.artifacts.wait_for_completion(
                notebook_id,
                task_id,
                timeout=timeout,
            )
    except TimeoutError as exc:
        logger.warning("NLM generation timed out for %s: %s", task_id, exc)
        repo.update_download_status(
            db,
            portal_id,
            DownloadStatus.FAILED,
            error=f"NLM generation timed out after {int(timeout)}s",
        )
        return
    except Exception as exc:
        logger.exception("Failed waiting for NLM artifact %s", task_id)
        repo.update_download_status(
            db,
            portal_id,
            DownloadStatus.FAILED,
            error=f"Wait error: {exc}",
        )
        return

    if result.is_failed:
        logger.warning("NLM reported failure for %s: %s", task_id, result.error)
        repo.update_download_status(
            db,
            portal_id,
            DownloadStatus.FAILED,
            error=result.error or "NLM generation failed",
        )
        return

    # Refresh the title from NLM (the user-visible name often updates after generation)
    try:
        from notebooklm import NotebookLMClient

        async with await NotebookLMClient.from_storage() as client:
            artifact = await client.artifacts.get(notebook_id, task_id)
        if artifact and artifact.title:
            db.table("nlm_artifacts").update({"title": artifact.title}).eq(
                "id", str(portal_id)
            ).execute()
    except Exception:
        # Title refresh is best-effort; not worth failing the whole pipeline
        logger.debug("Title refresh failed for %s", task_id, exc_info=True)

    # Flip to pending so the existing pipeline owns the download phase
    repo.update_download_status(db, portal_id, DownloadStatus.PENDING)
    await download_artifact_to_r2(portal_id)
