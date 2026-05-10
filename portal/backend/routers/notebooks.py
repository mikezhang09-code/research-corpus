from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, HTTPException

from ..database import get_supabase
from ..models import (
    GenerateRequest,
    LiveArtifact,
    LiveArtifactsResponse,
    NLMArtifactRead,
    NotebookRead,
)

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

    # Build a quick lookup of NLM completion state by artifact id
    nlm_complete_map = {a.id: a.is_completed for a in nlm_artifacts}

    # Self-healing: flip 'generating' rows whose NLM artifact is now ready,
    # and re-queue stuck 'pending' records (inserted but never downloaded).
    for row in saved_rows:
        nlm_id = row["nlm_artifact_id"]
        status = row["download_status"]
        if status == "generating" and nlm_complete_map.get(nlm_id):
            db.table("nlm_artifacts").update({"download_status": "pending"}).eq(
                "id", row["id"]
            ).execute()
            row["download_status"] = "pending"  # reflect in the response below
            background.add_task(download_artifact_to_r2, UUID(row["id"]))
        elif status == "pending" and not row.get("downloaded_at"):
            background.add_task(download_artifact_to_r2, UUID(row["id"]))

    artifacts: list[LiveArtifact] = []
    seen_ids: set[str] = set()
    for a in nlm_artifacts:
        kind = a.kind.value
        if kind == "unknown":
            continue
        fmt = _FORMAT_MAP.get(kind, "bin")
        saved = saved_map.get(a.id)
        seen_ids.add(a.id)
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

    # Surface saved rows that NLM's live list hasn't caught up to yet
    # (race after generate, or mind_map notes that don't appear in studio list).
    for row in saved_rows:
        if row["nlm_artifact_id"] in seen_ids:
            continue
        artifacts.append(
            LiveArtifact(
                nlm_id=row["nlm_artifact_id"],
                title=row.get("title") or row["artifact_type"],
                artifact_type=row["artifact_type"],
                file_format=row.get("file_format", "bin"),
                created_at=row.get("nlm_created_at"),
                is_completed=row["download_status"] == "done",
                portal_id=row["id"],
                download_status=row["download_status"],
                r2_url=row.get("r2_url"),
                download_error=row.get("download_error"),
            )
        )

    return LiveArtifactsResponse(
        notebook_id=notebook_id,
        notebook_title=notebook_title,
        artifacts=artifacts,
    )


# ---------------------------------------------------------------------------
# Generate
# ---------------------------------------------------------------------------

@router.post("/{notebook_id}/generate", response_model=LiveArtifact, status_code=201)
async def generate_artifact(
    notebook_id: str,
    req: GenerateRequest,
    background: BackgroundTasks,
):
    """Trigger NLM artifact generation, persist a portal row, schedule R2 download.

    Returns the new portal row immediately (status=generating). The detail
    page's polling loop picks up state transitions automatically.
    """
    try:
        from notebooklm import (
            AudioFormat, AudioLength, InfographicDetail, InfographicOrientation,
            InfographicStyle, NotebookLMClient, QuizDifficulty, QuizQuantity,
            ReportFormat, SlideDeckFormat, SlideDeckLength, VideoFormat, VideoStyle,
        )
    except ImportError:
        raise HTTPException(503, "notebooklm-py not available")

    if req.artifact_type not in _FORMAT_MAP:
        raise HTTPException(400, f"Unknown artifact_type: {req.artifact_type}")

    db = get_supabase()
    nb_rows = db.table("notebooks").select("title").eq("id", notebook_id).execute().data
    notebook_title = nb_rows[0]["title"] if nb_rows else None

    # Map UI strings → enum members. Returns None when no value supplied so the
    # client library uses its own default.
    def _map(enum_cls, value, mapping):
        if value is None:
            return None
        if value not in mapping:
            raise HTTPException(400, f"Invalid value '{value}' for {enum_cls.__name__}")
        return enum_cls[mapping[value]]

    instructions = req.description or None
    language = req.language or "en"

    async with await NotebookLMClient.from_storage() as client:
        try:
            t = req.artifact_type
            if t == "audio":
                status = await client.artifacts.generate_audio(
                    notebook_id, language=language, instructions=instructions,
                    audio_format=_map(AudioFormat, req.audio_format, {
                        "deep-dive": "DEEP_DIVE", "brief": "BRIEF",
                        "critique": "CRITIQUE", "debate": "DEBATE",
                    }),
                    audio_length=_map(AudioLength, req.audio_length, {
                        "short": "SHORT", "default": "DEFAULT", "long": "LONG",
                    }),
                )
            elif t == "video":
                if req.video_format == "cinematic":
                    status = await client.artifacts.generate_cinematic_video(
                        notebook_id, language=language, instructions=instructions,
                    )
                else:
                    status = await client.artifacts.generate_video(
                        notebook_id, language=language, instructions=instructions,
                        video_format=_map(VideoFormat, req.video_format, {
                            "explainer": "EXPLAINER", "brief": "BRIEF", "cinematic": "CINEMATIC",
                        }),
                        video_style=_map(VideoStyle, req.video_style, {
                            "auto": "AUTO_SELECT", "classic": "CLASSIC", "whiteboard": "WHITEBOARD",
                            "kawaii": "KAWAII", "anime": "ANIME", "watercolor": "WATERCOLOR",
                            "retro-print": "RETRO_PRINT", "heritage": "HERITAGE", "paper-craft": "PAPER_CRAFT",
                        }),
                    )
            elif t == "report":
                # Mirrors CLI's smart routing in cli/generate.py:1117-1126.
                rf_map = {
                    "briefing-doc": ReportFormat.BRIEFING_DOC,
                    "study-guide": ReportFormat.STUDY_GUIDE,
                    "blog-post": ReportFormat.BLOG_POST,
                    "custom": ReportFormat.CUSTOM,
                }
                report_format = rf_map.get(req.report_format or "briefing-doc", ReportFormat.BRIEFING_DOC)
                custom_prompt: str | None = None
                extra_instructions: str | None = None
                if req.description:
                    if report_format == ReportFormat.CUSTOM or req.report_format in (None, "briefing-doc"):
                        report_format = ReportFormat.CUSTOM if req.report_format in (None, "briefing-doc") else report_format
                        custom_prompt = req.description
                    else:
                        extra_instructions = req.description
                status = await client.artifacts.generate_report(
                    notebook_id, report_format=report_format, language=language,
                    custom_prompt=custom_prompt, extra_instructions=extra_instructions,
                )
            elif t == "slide_deck":
                status = await client.artifacts.generate_slide_deck(
                    notebook_id, language=language, instructions=instructions,
                    slide_format=_map(SlideDeckFormat, req.deck_format, {
                        "detailed": "DETAILED_DECK", "presenter": "PRESENTER_SLIDES",
                    }),
                    slide_length=_map(SlideDeckLength, req.deck_length, {
                        "default": "DEFAULT", "short": "SHORT",
                    }),
                )
            elif t == "quiz":
                status = await client.artifacts.generate_quiz(
                    notebook_id, instructions=instructions,
                    quantity=_map(QuizQuantity, req.quiz_quantity, {
                        "fewer": "FEWER", "standard": "STANDARD", "more": "MORE",
                    }),
                    difficulty=_map(QuizDifficulty, req.quiz_difficulty, {
                        "easy": "EASY", "medium": "MEDIUM", "hard": "HARD",
                    }),
                )
            elif t == "flashcards":
                status = await client.artifacts.generate_flashcards(
                    notebook_id, instructions=instructions,
                    quantity=_map(QuizQuantity, req.quiz_quantity, {
                        "fewer": "FEWER", "standard": "STANDARD", "more": "MORE",
                    }),
                    difficulty=_map(QuizDifficulty, req.quiz_difficulty, {
                        "easy": "EASY", "medium": "MEDIUM", "hard": "HARD",
                    }),
                )
            elif t == "infographic":
                status = await client.artifacts.generate_infographic(
                    notebook_id, language=language, instructions=instructions,
                    orientation=_map(InfographicOrientation, req.info_orientation, {
                        "landscape": "LANDSCAPE", "portrait": "PORTRAIT", "square": "SQUARE",
                    }),
                    detail_level=_map(InfographicDetail, req.info_detail, {
                        "concise": "CONCISE", "standard": "STANDARD", "detailed": "DETAILED",
                    }),
                    style=_map(InfographicStyle, req.info_style, {
                        "auto": "AUTO_SELECT", "sketch-note": "SKETCH_NOTE", "professional": "PROFESSIONAL",
                        "bento-grid": "BENTO_GRID", "editorial": "EDITORIAL", "instructional": "INSTRUCTIONAL",
                        "bricks": "BRICKS", "clay": "CLAY", "anime": "ANIME",
                        "kawaii": "KAWAII", "scientific": "SCIENTIFIC",
                    }),
                )
            elif t == "data_table":
                if not req.description:
                    raise HTTPException(400, "data_table requires a description")
                status = await client.artifacts.generate_data_table(
                    notebook_id, language=language, instructions=instructions,
                )
            elif t == "mind_map":
                # Special: mind_map is synchronous and returns a dict, not GenerationStatus.
                # Save the JSON straight to R2 — no waiting needed.
                from ..repositories import artifacts as repo
                from ..models import NLMArtifactCreate
                from ..storage import r2_key_for_artifact, upload_file
                import json as _json

                result = await client.artifacts.generate_mind_map(
                    notebook_id, language=language, instructions=instructions,
                )
                mind_map_data = result.get("mind_map") if isinstance(result, dict) else None
                note_id = result.get("note_id") if isinstance(result, dict) else None
                nlm_id = note_id or f"mind_map_{notebook_id}"
                row = repo.upsert_from_nlm(db, NLMArtifactCreate(
                    nlm_artifact_id=nlm_id,
                    notebook_id=notebook_id,
                    notebook_title=notebook_title,
                    artifact_type="mind_map",
                    file_format="json",
                    title=req.description or "Mind Map",
                ))
                portal_id = UUID(row["id"])
                key = r2_key_for_artifact(notebook_id, "mind_map", nlm_id, "json")
                data = _json.dumps(mind_map_data, ensure_ascii=False, indent=2).encode("utf-8")
                url = upload_file(key, data, "application/json; charset=utf-8")
                from ..models import DownloadStatus
                repo.update_download_status(
                    db, portal_id, DownloadStatus.DONE,
                    r2_key=key, r2_url=url, file_size_bytes=len(data),
                )
                row = repo.get(db, portal_id)
                return LiveArtifact(
                    nlm_id=nlm_id,
                    title=row["title"],
                    artifact_type="mind_map",
                    file_format="json",
                    created_at=None,
                    is_completed=True,
                    portal_id=row["id"],
                    download_status="done",
                    r2_url=url,
                    download_error=None,
                )
            else:
                raise HTTPException(400, f"Unsupported artifact_type: {t}")
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(502, f"NLM generation failed: {exc}")

    if not status.task_id:
        raise HTTPException(502, status.error or "NLM did not return a task_id")

    # Persist the new artifact row in 'generating' state
    from ..repositories import artifacts as repo
    from ..models import NLMArtifactCreate

    file_format = _FORMAT_MAP[req.artifact_type]
    row = repo.upsert_from_nlm(db, NLMArtifactCreate(
        nlm_artifact_id=status.task_id,
        notebook_id=notebook_id,
        notebook_title=notebook_title,
        artifact_type=req.artifact_type,
        file_format=file_format,
        title=req.description or req.artifact_type.replace("_", " ").title(),
    ))
    portal_id = UUID(row["id"])
    db.table("nlm_artifacts").update({"download_status": "generating"}).eq(
        "id", str(portal_id)
    ).execute()

    from ..tasks.generator import generate_then_download
    background.add_task(
        generate_then_download,
        notebook_id, status.task_id, portal_id, req.artifact_type,
    )

    return LiveArtifact(
        nlm_id=status.task_id,
        title=row["title"],
        artifact_type=req.artifact_type,
        file_format=file_format,
        created_at=None,
        is_completed=False,
        portal_id=row["id"],
        download_status="generating",
        r2_url=None,
        download_error=None,
    )
