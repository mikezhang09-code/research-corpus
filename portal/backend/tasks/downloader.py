from __future__ import annotations

import logging
import tempfile
from pathlib import Path
from uuid import UUID

logger = logging.getLogger(__name__)


async def download_artifact_to_r2(artifact_id: UUID) -> None:
    """Background task: fetch artifact from NotebookLM → upload to R2 → update Supabase."""
    from ..database import get_supabase
    from ..models import DownloadStatus
    from ..repositories import artifacts as repo
    from ..storage import r2_key_for_artifact, upload_file

    db = get_supabase()
    row = repo.get(db, artifact_id)
    if not row:
        logger.error("Artifact %s not found", artifact_id)
        return

    repo.update_download_status(db, artifact_id, DownloadStatus.DOWNLOADING)

    try:
        from notebooklm import NotebookLMClient

        notebook_id = row["notebook_id"]
        artifact_type = row["artifact_type"]
        nlm_artifact_id = row["nlm_artifact_id"]
        fmt = row["file_format"]

        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / f"{nlm_artifact_id}.{fmt}"

            async with await NotebookLMClient.from_storage() as client:
                await _download_by_type(client, notebook_id, artifact_type, fmt, str(out_path))

            data = out_path.read_bytes()

        mime = _mime_for_format(fmt)
        key = r2_key_for_artifact(notebook_id, artifact_type, nlm_artifact_id, fmt)
        url = upload_file(key, data, mime)

        repo.update_download_status(
            db,
            artifact_id,
            DownloadStatus.DONE,
            r2_key=key,
            r2_url=url,
            file_size_bytes=len(data),
        )
        logger.info("Artifact %s downloaded and uploaded to R2 (%d bytes)", artifact_id, len(data))

    except Exception as exc:
        logger.exception("Failed to download artifact %s", artifact_id)
        repo.update_download_status(db, artifact_id, DownloadStatus.FAILED, error=str(exc))


async def _download_by_type(
    client, notebook_id: str, artifact_type: str, fmt: str, out_path: str
) -> None:
    a = client.artifacts
    match artifact_type:
        case "audio":
            await a.download_audio(notebook_id, out_path)
        case "video":
            await a.download_video(notebook_id, out_path)
        case "report":
            await a.download_report(notebook_id, out_path)
        case "quiz":
            await a.download_quiz(notebook_id, out_path, output_format=fmt)
        case "flashcards":
            await a.download_flashcards(notebook_id, out_path, output_format=fmt)
        case "infographic":
            await a.download_infographic(notebook_id, out_path)
        case "slide_deck":
            await a.download_slide_deck(notebook_id, out_path, output_format=fmt)
        case "data_table":
            await a.download_data_table(notebook_id, out_path)
        case "mind_map":
            await a.download_mind_map(notebook_id, out_path)
        case _:
            raise ValueError(f"Unknown artifact type: {artifact_type}")


def _mime_for_format(fmt: str) -> str:
    return {
        "mp4": "video/mp4",
        "mp3": "audio/mpeg",
        "md": "text/markdown",
        "pdf": "application/pdf",
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "json": "application/json",
        "png": "image/png",
        "csv": "text/csv",
        "html": "text/html",
    }.get(fmt, "application/octet-stream")
