from __future__ import annotations

import asyncio
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Body, File, HTTPException, UploadFile

from ..database import get_supabase
from ..models import (
    BulkDownloadRequest,
    ChatHistoryResponse,
    ChatReferenceRead,
    ChatRequest,
    ChatResponse,
    ChatTurn,
    GenerateRequest,
    LiveArtifact,
    LiveArtifactsResponse,
    NLMArtifactRead,
    NotebookCreateRequest,
    NotebookDescriptionResponse,
    NotebookRead,
    NotebookRenameRequest,
    ResearchImportRequest,
    ResearchSource,
    ResearchStartRequest,
    ResearchStartResponse,
    ResearchStatusResponse,
    SourceRead,
    SourceTextRequest,
    SourceUrlRequest,
    SuggestedTopicRead,
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

# Portal language codes (from the frontend's global toggle + per-artifact picker)
# → NotebookLM's canonical locale codes. NotebookLM silently ignores codes it
# doesn't recognise and falls back to its account default, so anything sent to
# the client library must be mapped to a code it actually accepts. Unmapped
# codes pass through unchanged (they already match, e.g. "ja", "fr").
_NLM_LANGUAGE: dict[str, str] = {
    "en": "en",
    "zh": "zh_Hans",  # global toggle "Chinese" → Simplified
    "zh-TW": "zh_Hant",
    "pt": "pt_BR",
    "ar": "ar_001",
}


def _nlm_lang(code: str | None) -> str:
    """Resolve a portal language code to a NotebookLM-accepted locale code."""
    if not code:
        return "en"
    return _NLM_LANGUAGE.get(code, code)


@router.get("", response_model=list[NotebookRead])
async def list_notebooks(include_hidden: bool = False):
    db = get_supabase()
    q = db.table("notebooks").select("*")
    if not include_hidden:
        q = q.eq("hidden", False)
    rows = q.order("last_synced_at", desc=True).execute().data
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
        # notebooks.list() does not populate sources_count — fetch it per
        # notebook in parallel so the landing page can show real counts.
        source_lists = await asyncio.gather(
            *(client.sources.list(nb.id) for nb in notebooks),
            return_exceptions=True,
        )

    rows = [
        {
            "id": nb.id,
            "title": nb.title,
            "sources_count": (
                len(sources) if not isinstance(sources, BaseException) else nb.sources_count
            ),
            "is_owner": nb.is_owner,
            "nlm_created_at": nb.created_at.isoformat() if nb.created_at else None,
        }
        for nb, sources in zip(notebooks, source_lists, strict=False)
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


@router.delete("/{notebook_id}", status_code=204)
async def delete_notebook(notebook_id: str):
    """Delete a notebook from NotebookLM and clean up local artifacts + R2 files.

    Library items (already saved to library) are kept — the foreign key uses
    ON DELETE SET NULL, and library items have their own R2 keys that aren't
    tied to the notebook's saved-artifact storage.
    """
    try:
        from notebooklm import NotebookLMClient
    except ImportError:
        raise HTTPException(503, "notebooklm-py not available")

    try:
        async with await NotebookLMClient.from_storage() as client:
            await client.notebooks.delete(notebook_id)
    except Exception as exc:
        raise HTTPException(502, f"Delete failed: {exc}")

    db = get_supabase()

    # Collect R2 keys for this notebook's saved artifacts before the cascade
    # drops the rows, so we can free up R2 storage too.
    artifact_rows = (
        db.table("nlm_artifacts").select("r2_key").eq("notebook_id", notebook_id).execute().data
    )
    from ..storage import delete_file

    for row in artifact_rows:
        key = row.get("r2_key")
        if not key:
            continue
        try:
            delete_file(key)
        except Exception:
            # Don't fail the whole delete on a single R2 cleanup error —
            # the user has already lost the notebook on NotebookLM's side.
            pass

    db.table("notebooks").delete().eq("id", notebook_id).execute()


@router.post("/{notebook_id}/restore", response_model=NotebookRead)
async def restore_notebook(notebook_id: str):
    """Un-hide a notebook (clear the hidden flag set by remove-from-recent)."""
    db = get_supabase()
    updated = db.table("notebooks").update({"hidden": False}).eq("id", notebook_id).execute().data
    if not updated:
        raise HTTPException(404, f"Notebook {notebook_id} not found")
    return updated[0]


@router.patch("/{notebook_id}", response_model=NotebookRead)
async def rename_notebook(notebook_id: str, req: NotebookRenameRequest):
    """Update a notebook's title and/or cover emoji.

    Title changes are pushed to NotebookLM; emoji is purely local cosmetic
    state. Either field is optional, but at least one must be provided.
    """
    new_title = req.title.strip() if req.title is not None else None
    new_emoji = req.cover_emoji
    if new_title == "":
        raise HTTPException(400, "Title cannot be empty")
    if new_title is None and new_emoji is None:
        raise HTTPException(400, "Provide at least one of title or cover_emoji")

    if new_title is not None:
        try:
            from notebooklm import NotebookLMClient
        except ImportError:
            raise HTTPException(503, "notebooklm-py not available")
        try:
            async with await NotebookLMClient.from_storage() as client:
                await client.notebooks.rename(notebook_id, new_title)
        except Exception as exc:
            raise HTTPException(502, f"Rename failed: {exc}")

    update: dict[str, str | None] = {}
    if new_title is not None:
        update["title"] = new_title
    if new_emoji is not None:
        # Allow clearing by passing an empty string; store as NULL.
        update["cover_emoji"] = new_emoji or None

    db = get_supabase()
    updated = db.table("notebooks").update(update).eq("id", notebook_id).execute().data
    if not updated:
        raise HTTPException(404, f"Notebook {notebook_id} not found")
    return updated[0]


@router.post("/{notebook_id}/remove-from-recent", status_code=204)
async def remove_notebook_from_recent(notebook_id: str):
    """Hide the notebook from the portal list and from NotebookLM's recents.

    Local DB rows and R2 files are kept intact — call DELETE if you want
    full cleanup. Use POST /restore (or re-sync) to bring it back.
    """
    try:
        from notebooklm import NotebookLMClient
    except ImportError:
        raise HTTPException(503, "notebooklm-py not available")

    try:
        async with await NotebookLMClient.from_storage() as client:
            await client.notebooks.remove_from_recent(notebook_id)
    except Exception as exc:
        raise HTTPException(502, f"Remove-from-recent failed: {exc}")

    db = get_supabase()
    db.table("notebooks").update({"hidden": True}).eq("id", notebook_id).execute()


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
        rows.append(
            {
                "nlm_artifact_id": a.id,
                "notebook_id": notebook_id,
                "notebook_title": notebook_title,
                "artifact_type": kind,
                "file_format": fmt,
                "title": a.title or kind,
                "nlm_created_at": a.created_at.isoformat() if a.created_at else None,
            }
        )

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


@router.post("/{notebook_id}/artifacts/download")
async def download_notebook_artifacts(
    notebook_id: str, body: BulkDownloadRequest | None = Body(None)
):
    """Stream a zip of this notebook's saved artifacts (those downloaded to R2).

    Omit ``ids`` to download every saved artifact; pass ``ids`` (portal artifact
    UUIDs) to download a subset. Unsaved artifacts have no R2 file and are
    skipped — the count is returned in the ``X-Skipped-Count`` header so the UI
    can tell the user how many were left out.
    """
    from ..storage import build_zip, zip_response

    db = get_supabase()
    rows = (
        db.table("nlm_artifacts").select("*").eq("notebook_id", notebook_id).execute().data
    )

    if body and body.ids:
        wanted = {str(aid) for aid in body.ids}
        rows = [r for r in rows if str(r.get("id")) in wanted]
        if len(rows) != len(wanted):
            raise HTTPException(404, "One or more artifacts were not found")

    requested = len(rows)
    saved = [r for r in rows if r.get("download_status") == "done" and r.get("r2_key")]
    if not saved:
        raise HTTPException(404, "No saved artifacts to download — save them first")

    entries = [
        (f"{r.get('title') or r['artifact_type']}.{r.get('file_format') or 'bin'}", r["r2_key"])
        for r in saved
    ]
    nb_rows = db.table("notebooks").select("title").eq("id", notebook_id).execute().data
    zip_name = f"{(nb_rows[0]['title'] if nb_rows else notebook_id)}.zip"

    resp = zip_response(build_zip(entries), zip_name)
    resp.headers["X-Skipped-Count"] = str(requested - len(saved))
    return resp


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

    saved_rows = db.table("nlm_artifacts").select("*").eq("notebook_id", notebook_id).execute().data

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
        saved = saved_map.get(a.id)
        # Use the saved row's format when available (e.g. user chose pptx for a slide_deck).
        fmt = saved["file_format"] if saved else _FORMAT_MAP.get(kind, "bin")
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
            AudioFormat,
            AudioLength,
            InfographicDetail,
            InfographicOrientation,
            InfographicStyle,
            NotebookLMClient,
            QuizDifficulty,
            QuizQuantity,
            ReportFormat,
            SlideDeckFormat,
            SlideDeckLength,
            VideoFormat,
            VideoStyle,
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
    language = _nlm_lang(req.language)

    async with await NotebookLMClient.from_storage() as client:
        try:
            t = req.artifact_type
            if t == "audio":
                status = await client.artifacts.generate_audio(
                    notebook_id,
                    language=language,
                    instructions=instructions,
                    audio_format=_map(
                        AudioFormat,
                        req.audio_format,
                        {
                            "deep-dive": "DEEP_DIVE",
                            "brief": "BRIEF",
                            "critique": "CRITIQUE",
                            "debate": "DEBATE",
                        },
                    ),
                    audio_length=_map(
                        AudioLength,
                        req.audio_length,
                        {
                            "short": "SHORT",
                            "default": "DEFAULT",
                            "long": "LONG",
                        },
                    ),
                )
            elif t == "video":
                if req.video_format == "cinematic":
                    status = await client.artifacts.generate_cinematic_video(
                        notebook_id,
                        language=language,
                        instructions=instructions,
                    )
                else:
                    status = await client.artifacts.generate_video(
                        notebook_id,
                        language=language,
                        instructions=instructions,
                        video_format=_map(
                            VideoFormat,
                            req.video_format,
                            {
                                "explainer": "EXPLAINER",
                                "brief": "BRIEF",
                                "cinematic": "CINEMATIC",
                            },
                        ),
                        video_style=_map(
                            VideoStyle,
                            req.video_style,
                            {
                                "auto": "AUTO_SELECT",
                                "classic": "CLASSIC",
                                "whiteboard": "WHITEBOARD",
                                "kawaii": "KAWAII",
                                "anime": "ANIME",
                                "watercolor": "WATERCOLOR",
                                "retro-print": "RETRO_PRINT",
                                "heritage": "HERITAGE",
                                "paper-craft": "PAPER_CRAFT",
                            },
                        ),
                    )
            elif t == "report":
                # Mirrors CLI's smart routing in cli/generate.py:1117-1126.
                rf_map = {
                    "briefing-doc": ReportFormat.BRIEFING_DOC,
                    "study-guide": ReportFormat.STUDY_GUIDE,
                    "blog-post": ReportFormat.BLOG_POST,
                    "custom": ReportFormat.CUSTOM,
                }
                report_format = rf_map.get(
                    req.report_format or "briefing-doc", ReportFormat.BRIEFING_DOC
                )
                custom_prompt: str | None = None
                extra_instructions: str | None = None
                if req.description:
                    if report_format == ReportFormat.CUSTOM or req.report_format in (
                        None,
                        "briefing-doc",
                    ):
                        report_format = (
                            ReportFormat.CUSTOM
                            if req.report_format in (None, "briefing-doc")
                            else report_format
                        )
                        custom_prompt = req.description
                    else:
                        extra_instructions = req.description
                status = await client.artifacts.generate_report(
                    notebook_id,
                    report_format=report_format,
                    language=language,
                    custom_prompt=custom_prompt,
                    extra_instructions=extra_instructions,
                )
            elif t == "slide_deck":
                status = await client.artifacts.generate_slide_deck(
                    notebook_id,
                    language=language,
                    instructions=instructions,
                    slide_format=_map(
                        SlideDeckFormat,
                        req.deck_format,
                        {
                            "detailed": "DETAILED_DECK",
                            "presenter": "PRESENTER_SLIDES",
                        },
                    ),
                    slide_length=_map(
                        SlideDeckLength,
                        req.deck_length,
                        {
                            "default": "DEFAULT",
                            "short": "SHORT",
                        },
                    ),
                )
            elif t == "quiz":
                # Quiz has no per-artifact language slot in NotebookLM's RPC, so
                # the only lever is the account-wide output language. Set it to
                # the requested language right before generating.
                await client.settings.set_output_language(language)
                status = await client.artifacts.generate_quiz(
                    notebook_id,
                    instructions=instructions,
                    quantity=_map(
                        QuizQuantity,
                        req.quiz_quantity,
                        {
                            "fewer": "FEWER",
                            "standard": "STANDARD",
                            "more": "MORE",
                        },
                    ),
                    difficulty=_map(
                        QuizDifficulty,
                        req.quiz_difficulty,
                        {
                            "easy": "EASY",
                            "medium": "MEDIUM",
                            "hard": "HARD",
                        },
                    ),
                )
            elif t == "flashcards":
                # Same as quiz: no per-artifact language slot, so steer the
                # account-wide output language before generating.
                await client.settings.set_output_language(language)
                status = await client.artifacts.generate_flashcards(
                    notebook_id,
                    instructions=instructions,
                    quantity=_map(
                        QuizQuantity,
                        req.quiz_quantity,
                        {
                            "fewer": "FEWER",
                            "standard": "STANDARD",
                            "more": "MORE",
                        },
                    ),
                    difficulty=_map(
                        QuizDifficulty,
                        req.quiz_difficulty,
                        {
                            "easy": "EASY",
                            "medium": "MEDIUM",
                            "hard": "HARD",
                        },
                    ),
                )
            elif t == "infographic":
                status = await client.artifacts.generate_infographic(
                    notebook_id,
                    language=language,
                    instructions=instructions,
                    orientation=_map(
                        InfographicOrientation,
                        req.info_orientation,
                        {
                            "landscape": "LANDSCAPE",
                            "portrait": "PORTRAIT",
                            "square": "SQUARE",
                        },
                    ),
                    detail_level=_map(
                        InfographicDetail,
                        req.info_detail,
                        {
                            "concise": "CONCISE",
                            "standard": "STANDARD",
                            "detailed": "DETAILED",
                        },
                    ),
                    style=_map(
                        InfographicStyle,
                        req.info_style,
                        {
                            "auto": "AUTO_SELECT",
                            "sketch-note": "SKETCH_NOTE",
                            "professional": "PROFESSIONAL",
                            "bento-grid": "BENTO_GRID",
                            "editorial": "EDITORIAL",
                            "instructional": "INSTRUCTIONAL",
                            "bricks": "BRICKS",
                            "clay": "CLAY",
                            "anime": "ANIME",
                            "kawaii": "KAWAII",
                            "scientific": "SCIENTIFIC",
                        },
                    ),
                )
            elif t == "data_table":
                if not req.description:
                    raise HTTPException(400, "data_table requires a description")
                status = await client.artifacts.generate_data_table(
                    notebook_id,
                    language=language,
                    instructions=instructions,
                )
            elif t == "mind_map":
                # Special: mind_map is synchronous and returns a dict, not GenerationStatus.
                # Save the JSON straight to R2 — no waiting needed.
                import json as _json

                from ..models import NLMArtifactCreate
                from ..repositories import artifacts as repo
                from ..storage import r2_key_for_artifact, upload_file

                result = await client.artifacts.generate_mind_map(
                    notebook_id,
                    language=language,
                    instructions=instructions,
                )
                mind_map_data = result.get("mind_map") if isinstance(result, dict) else None
                note_id = result.get("note_id") if isinstance(result, dict) else None
                nlm_id = note_id or f"mind_map_{notebook_id}"
                row = repo.upsert_from_nlm(
                    db,
                    NLMArtifactCreate(
                        nlm_artifact_id=nlm_id,
                        notebook_id=notebook_id,
                        notebook_title=notebook_title,
                        artifact_type="mind_map",
                        file_format="json",
                        title=req.description or "Mind Map",
                    ),
                )
                portal_id = UUID(row["id"])
                key = r2_key_for_artifact(notebook_id, "mind_map", nlm_id, "json")
                data = _json.dumps(mind_map_data, ensure_ascii=False, indent=2).encode("utf-8")
                url = upload_file(key, data, "application/json; charset=utf-8")
                from ..models import DownloadStatus

                repo.update_download_status(
                    db,
                    portal_id,
                    DownloadStatus.DONE,
                    r2_key=key,
                    r2_url=url,
                    file_size_bytes=len(data),
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
    from ..models import NLMArtifactCreate
    from ..repositories import artifacts as repo

    file_format = _FORMAT_MAP[req.artifact_type]
    row = repo.upsert_from_nlm(
        db,
        NLMArtifactCreate(
            nlm_artifact_id=status.task_id,
            notebook_id=notebook_id,
            notebook_title=notebook_title,
            artifact_type=req.artifact_type,
            file_format=file_format,
            title=req.description or req.artifact_type.replace("_", " ").title(),
        ),
    )
    portal_id = UUID(row["id"])
    db.table("nlm_artifacts").update({"download_status": "generating"}).eq(
        "id", str(portal_id)
    ).execute()

    from ..tasks.generator import generate_then_download

    background.add_task(
        generate_then_download,
        notebook_id,
        status.task_id,
        portal_id,
        req.artifact_type,
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
        "cover_emoji": req.cover_emoji,
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

    # NotebookLM's RPC has no language param — prepend a directive to the
    # question so the model follows the user's preference. Citations reference
    # source text, not the prepended directive, so this is safe.
    lang = (req.language or "en").lower()
    if lang == "zh":
        question = f"[Please respond in Simplified Chinese / 请用中文回答]\n\n{req.question}"
    else:
        question = f"[Please respond in English]\n\n{req.question}"

    try:
        async with await NotebookLMClient.from_storage() as client:
            result = await client.chat.ask(
                notebook_id,
                question,
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


# ---------------------------------------------------------------------------
# Notebook description (AI summary + suggested topics)
# ---------------------------------------------------------------------------


@router.get("/{notebook_id}/description", response_model=NotebookDescriptionResponse)
async def get_notebook_description(notebook_id: str):
    """Fetch NotebookLM's AI-generated summary + suggested topics for the notebook."""
    try:
        from notebooklm import NotebookLMClient
    except ImportError:
        raise HTTPException(503, "notebooklm-py not available")

    try:
        async with await NotebookLMClient.from_storage() as client:
            desc = await client.notebooks.get_description(notebook_id)
    except Exception as exc:
        raise HTTPException(502, f"Description fetch failed: {exc}")

    return NotebookDescriptionResponse(
        summary=desc.summary,
        suggested_topics=[
            SuggestedTopicRead(question=t.question, prompt=t.prompt) for t in desc.suggested_topics
        ],
    )


# ---------------------------------------------------------------------------
# Web research / "Discover sources" — proxies notebooklm.client.research.*
# ---------------------------------------------------------------------------


@router.post("/{notebook_id}/research/start", response_model=ResearchStartResponse)
async def research_start(notebook_id: str, req: ResearchStartRequest):
    """Kick off a Google web search for sources matching the query."""
    if not req.query.strip():
        raise HTTPException(400, "query is required")
    try:
        from notebooklm import NotebookLMClient
    except ImportError:
        raise HTTPException(503, "notebooklm-py not available")

    try:
        async with await NotebookLMClient.from_storage() as client:
            result = await client.research.start(
                notebook_id,
                req.query.strip(),
                req.source,
                req.mode,
            )
    except Exception as exc:
        raise HTTPException(502, f"Research start failed: {exc}")

    if not result or "task_id" not in result:
        raise HTTPException(502, "Research did not return a task id")
    return ResearchStartResponse(task_id=result["task_id"])


@router.get("/{notebook_id}/research/status", response_model=ResearchStatusResponse)
async def research_status(notebook_id: str):
    """Poll the latest research task on a notebook."""
    try:
        from notebooklm import NotebookLMClient
    except ImportError:
        raise HTTPException(503, "notebooklm-py not available")

    try:
        async with await NotebookLMClient.from_storage() as client:
            result = await client.research.poll(notebook_id)
    except Exception as exc:
        raise HTTPException(502, f"Research poll failed: {exc}")

    return ResearchStatusResponse(
        status=result.get("status", "no_research"),
        query=result.get("query", ""),
        task_id=result.get("task_id"),
        summary=result.get("summary", ""),
        sources=[
            ResearchSource(
                url=s.get("url", ""),
                title=s.get("title", ""),
                result_type=s.get("result_type"),
                research_task_id=s.get("research_task_id"),
            )
            for s in result.get("sources", [])
        ],
    )


@router.post("/{notebook_id}/research/import", status_code=204)
async def research_import(notebook_id: str, req: ResearchImportRequest):
    """Import the user-selected subset of research sources into the notebook.

    Importing 5–10 URLs takes 30–90 s server-side because NotebookLM has to
    fetch and process each one. The default 30 s RPC timeout was hitting
    "Request timed out calling IMPORT_RESEARCH" — bump it to 180 s here.
    Even when the timeout fires, the import often succeeds on Google's side;
    the frontend re-polls the source list and the new sources appear.
    """
    if not req.sources:
        raise HTTPException(400, "Pick at least one source")
    try:
        from notebooklm import NotebookLMClient
    except ImportError:
        raise HTTPException(503, "notebooklm-py not available")

    payload = [{"url": s.url, "title": s.title} for s in req.sources]
    try:
        async with await NotebookLMClient.from_storage(timeout=180.0) as client:
            await client.research.import_sources(notebook_id, req.task_id, payload)
    except Exception as exc:
        raise HTTPException(502, f"Research import failed: {exc}")
