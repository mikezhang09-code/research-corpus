from __future__ import annotations

import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile

from ..database import get_supabase
from ..models import (
    ChatHistoryResponse,
    ChatRequest,
    ChatReferenceRead,
    ChatResponse,
    ChatTurn,
    GenerateRequest,
    LiveArtifact,
    LiveArtifactsResponse,
    NLMArtifactRead,
    NotebookCreateRequest,
    NotebookRead,
    SourceRead,
    SourceTextRequest,
    SourceUrlRequest,
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

    # Reconcile against NLM: drop failed orphans (artifact deleted in Google's
    # UI; nothing of value preserved on our side). Done orphans are kept and
    # flagged below as only_in_portal. Other transient orphans (generating,
    # pending, downloading) self-resolve so we don't touch them — that avoids
    # racing with a freshly-kicked-off generate that hasn't appeared in NLM's
    # list yet.
    nlm_ids = {a.id for a in nlm_artifacts}
    cleaned: list[dict] = []
    for row in saved_rows:
        if row["nlm_artifact_id"] not in nlm_ids and row["download_status"] == "failed":
            if row.get("r2_key"):
                try:
                    from ..storage import delete_file
                    delete_file(row["r2_key"])
                except Exception:
                    pass  # best-effort; don't fail the whole sync
            db.table("nlm_artifacts").delete().eq("id", row["id"]).execute()
        else:
            cleaned.append(row)
    saved_rows = cleaned
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

    # Surface saved rows that NLM's live list doesn't include. Two cases:
    # (a) Mind-map notes / freshly-generated artifacts NLM hasn't listed yet
    #     — these will eventually be seen and merged on later refreshes.
    # (b) The user deleted the artifact in NLM but we still have the file
    #     in R2 → flag with only_in_portal so the UI can label it clearly.
    for row in saved_rows:
        if row["nlm_artifact_id"] in seen_ids:
            continue
        # Only flag as portal-only when we actually preserved a file (status=done).
        # Other states are still in-flight and will resolve naturally.
        is_preserved_orphan = row["download_status"] == "done"
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
                only_in_portal=is_preserved_orphan,
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


# ---------------------------------------------------------------------------
# Create notebook + source management
# ---------------------------------------------------------------------------

def _to_source_read(s) -> SourceRead:
    """Convert a notebooklm Source dataclass to the API response shape."""
    return SourceRead(
        id=s.id,
        title=s.title,
        url=s.url,
        kind=s.kind.value,
        status=int(s.status),
        is_ready=s.is_ready,
        is_processing=s.is_processing,
        is_error=s.is_error,
        created_at=s.created_at,
    )


@router.post("", response_model=NotebookRead, status_code=201)
async def create_notebook(req: NotebookCreateRequest):
    """Create a new NotebookLM notebook and cache it in Supabase."""
    if not req.title.strip():
        raise HTTPException(400, "title is required")
    try:
        from notebooklm import NotebookLMClient
    except ImportError:
        raise HTTPException(503, "notebooklm-py not available")

    db = get_supabase()
    async with await NotebookLMClient.from_storage() as client:
        try:
            nb = await client.notebooks.create(req.title)
        except Exception as exc:
            raise HTTPException(502, f"NotebookLM create failed: {exc}")

    row = {
        "id": nb.id,
        "title": nb.title,
        "sources_count": nb.sources_count,
        "is_owner": nb.is_owner,
        "nlm_created_at": nb.created_at.isoformat() if nb.created_at else None,
        "last_synced_at": datetime.now(timezone.utc).isoformat(),
    }
    db.table("notebooks").upsert(row, on_conflict="id").execute()
    return db.table("notebooks").select("*").eq("id", nb.id).execute().data[0]


@router.get("/{notebook_id}/sources", response_model=list[SourceRead])
async def list_sources(notebook_id: str):
    """Live source list from the NLM API."""
    try:
        from notebooklm import NotebookLMClient
    except ImportError:
        raise HTTPException(503, "notebooklm-py not available")
    async with await NotebookLMClient.from_storage() as client:
        sources = await client.sources.list(notebook_id)
    return [_to_source_read(s) for s in sources]


@router.post("/{notebook_id}/sources/url", response_model=SourceRead, status_code=201)
async def add_source_url(notebook_id: str, req: SourceUrlRequest):
    """Add a URL source. NLM auto-detects YouTube links."""
    try:
        from notebooklm import NotebookLMClient
    except ImportError:
        raise HTTPException(503, "notebooklm-py not available")
    async with await NotebookLMClient.from_storage() as client:
        try:
            source = await client.sources.add_url(notebook_id, req.url)
        except Exception as exc:
            raise HTTPException(502, f"add_url failed: {exc}")
    return _to_source_read(source)


@router.post("/{notebook_id}/sources/text", response_model=SourceRead, status_code=201)
async def add_source_text(notebook_id: str, req: SourceTextRequest):
    """Add a pasted-text source."""
    if not req.title.strip() or not req.content.strip():
        raise HTTPException(400, "title and content are required")
    try:
        from notebooklm import NotebookLMClient
    except ImportError:
        raise HTTPException(503, "notebooklm-py not available")
    async with await NotebookLMClient.from_storage() as client:
        try:
            source = await client.sources.add_text(notebook_id, req.title, req.content)
        except Exception as exc:
            raise HTTPException(502, f"add_text failed: {exc}")
    return _to_source_read(source)


@router.post("/{notebook_id}/sources/file", response_model=SourceRead, status_code=201)
async def add_source_file(notebook_id: str, file: UploadFile = File(...)):
    """Stream an uploaded file through to NLM's resumable upload protocol.

    Persists the upload to a temp directory using the *original* filename so
    NotebookLM displays it correctly (with Chinese / other Unicode preserved)
    rather than a random tmpXXXX name.
    """
    import shutil

    try:
        from notebooklm import NotebookLMClient
    except ImportError:
        raise HTTPException(503, "notebooklm-py not available")

    # Path().name strips any parent components, neutralising traversal
    # ("../../etc/passwd" → "passwd"), and preserves Unicode characters.
    original_name = Path(file.filename or "upload").name or "upload"

    tmp_dir = tempfile.mkdtemp()
    tmp_path = Path(tmp_dir) / original_name
    try:
        with tmp_path.open("wb") as f:
            while chunk := await file.read(64 * 1024):
                f.write(chunk)
        async with await NotebookLMClient.from_storage() as client:
            try:
                source = await client.sources.add_file(notebook_id, str(tmp_path))
            except Exception as exc:
                raise HTTPException(502, f"add_file failed: {exc}")
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
    return _to_source_read(source)


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

@router.post("/{notebook_id}/chat", response_model=ChatResponse)
async def chat_ask(notebook_id: str, req: ChatRequest):
    """Ask the notebook a question, optionally continuing an existing conversation."""
    try:
        from notebooklm import NotebookLMClient
    except ImportError:
        raise HTTPException(503, "notebooklm-py not available")

    try:
        async with await NotebookLMClient.from_storage() as client:
            result = await client.chat.ask(
                notebook_id,
                req.question,
                source_ids=req.source_ids,
                conversation_id=req.conversation_id,
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"Chat request failed: {exc}")

    return ChatResponse(
        answer=result.answer,
        conversation_id=result.conversation_id,
        turn_number=result.turn_number,
        is_follow_up=result.is_follow_up,
        references=[
            ChatReferenceRead(
                source_id=ref.source_id,
                citation_number=ref.citation_number,
                cited_text=ref.cited_text,
            )
            for ref in result.references
        ],
    )


@router.get("/{notebook_id}/chat/history", response_model=ChatHistoryResponse)
async def get_chat_history(
    notebook_id: str,
    conversation_id: str | None = None,
    limit: int = 100,
):
    """Return prior (question, answer) turns for a notebook conversation."""
    try:
        from notebooklm import NotebookLMClient
    except ImportError:
        raise HTTPException(503, "notebooklm-py not available")

    async with await NotebookLMClient.from_storage() as client:
        resolved_id = conversation_id or await client.chat.get_conversation_id(notebook_id)
        if not resolved_id:
            return ChatHistoryResponse(turns=[], conversation_id=None)

        try:
            pairs = await client.chat.get_history(
                notebook_id,
                limit=limit,
                conversation_id=resolved_id,
            )
        except Exception:
            return ChatHistoryResponse(turns=[], conversation_id=resolved_id)

    return ChatHistoryResponse(
        turns=[ChatTurn(question=q, answer=a) for q, a in pairs],
        conversation_id=resolved_id,
    )
