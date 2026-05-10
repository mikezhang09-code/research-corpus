from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class DownloadStatus(str, Enum):
    GENERATING = "generating"  # NLM is producing the artifact (pre-download)
    PENDING = "pending"
    DOWNLOADING = "downloading"
    DONE = "done"
    FAILED = "failed"


class LibrarySourceType(str, Enum):
    UPLOAD = "upload"
    DRIVE = "drive"
    YOUTUBE_LINK = "youtube_link"
    WEB_LINK = "web_link"


# ---------------------------------------------------------------------------
# Notebooks
# ---------------------------------------------------------------------------

class NotebookRead(BaseModel):
    id: str
    title: str
    sources_count: int
    is_owner: bool
    nlm_created_at: datetime | None = None
    last_synced_at: datetime


# ---------------------------------------------------------------------------
# NLM Artifacts
# ---------------------------------------------------------------------------

class NLMArtifactRead(BaseModel):
    id: UUID
    nlm_artifact_id: str
    notebook_id: str | None
    notebook_title: str | None
    artifact_type: str
    file_format: str
    title: str
    summary: str
    r2_key: str | None
    r2_url: str | None
    file_size_bytes: int | None
    download_status: DownloadStatus
    downloaded_at: datetime | None
    download_error: str | None
    nlm_created_at: datetime | None
    portal_added_at: datetime
    tags: list[str]
    notes: str
    library_item_id: UUID | None


class NLMArtifactCreate(BaseModel):
    nlm_artifact_id: str
    notebook_id: str
    notebook_title: str | None = None
    artifact_type: str
    file_format: str
    title: str = ""
    nlm_created_at: datetime | None = None
    tags: list[str] = Field(default_factory=list)


class NLMArtifactUpdate(BaseModel):
    title: str | None = None
    summary: str | None = None
    tags: list[str] | None = None
    notes: str | None = None


class NLMArtifactListResponse(BaseModel):
    items: list[NLMArtifactRead]
    total: int


# ---------------------------------------------------------------------------
# Library Items
# ---------------------------------------------------------------------------

class LibraryItemRead(BaseModel):
    id: UUID
    title: str
    description: str
    source_type: LibrarySourceType
    original_name: str
    mime_type: str | None
    file_ext: str | None
    r2_key: str | None
    r2_url: str | None
    file_size_bytes: int | None
    is_link_only: bool
    external_url: str | None
    drive_file_id: str | None
    drive_mime_type: str | None
    summary: str
    tags: list[str]
    collection: str | None
    added_at: datetime
    last_modified: datetime | None


class LibraryItemCreate(BaseModel):
    title: str = ""
    description: str = ""
    source_type: LibrarySourceType
    original_name: str
    mime_type: str | None = None
    file_ext: str | None = None
    is_link_only: bool = False
    external_url: str | None = None
    drive_file_id: str | None = None
    drive_mime_type: str | None = None
    tags: list[str] = Field(default_factory=list)
    collection: str | None = None


class LibraryItemUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    summary: str | None = None
    tags: list[str] | None = None
    collection: str | None = None


class LibraryItemListResponse(BaseModel):
    items: list[LibraryItemRead]
    total: int


# ---------------------------------------------------------------------------
# Generate request (single endpoint dispatches to all 9 generate_* methods)
# ---------------------------------------------------------------------------

class GenerateRequest(BaseModel):
    """Unified request for POST /api/notebooks/{id}/generate.

    Only fields relevant to `artifact_type` are read; the rest are ignored.
    Allowed string values mirror the CLI flag choices in src/notebooklm/cli/generate.py.
    """
    artifact_type: str  # audio | video | report | quiz | flashcards | infographic | slide_deck | data_table | mind_map
    description: str = ""
    language: str | None = None

    # audio
    audio_format: str | None = None  # deep-dive | brief | critique | debate
    audio_length: str | None = None  # short | default | long
    # video
    video_format: str | None = None  # explainer | brief | cinematic
    video_style: str | None = None   # auto | classic | whiteboard | kawaii | anime | watercolor | retro-print | heritage | paper-craft
    # report
    report_format: str | None = None  # briefing-doc | study-guide | blog-post | custom
    # slide_deck
    deck_format: str | None = None  # detailed | presenter
    deck_length: str | None = None  # default | short
    # quiz / flashcards
    quiz_quantity: str | None = None    # fewer | standard | more
    quiz_difficulty: str | None = None  # easy | medium | hard
    # infographic
    info_orientation: str | None = None  # landscape | portrait | square
    info_detail: str | None = None       # concise | standard | detailed
    info_style: str | None = None        # auto | sketch-note | professional | bento-grid | editorial | instructional | bricks | clay | anime | kawaii | scientific


# ---------------------------------------------------------------------------
# Live artifacts (read directly from NLM API, merged with portal state)
# ---------------------------------------------------------------------------

class LiveArtifact(BaseModel):
    nlm_id: str
    title: str
    artifact_type: str
    file_format: str
    created_at: datetime | None = None
    is_completed: bool
    # Set only when the artifact has been saved to the portal
    portal_id: str | None = None
    download_status: str | None = None
    r2_url: str | None = None
    download_error: str | None = None


class LiveArtifactsResponse(BaseModel):
    notebook_id: str
    notebook_title: str | None = None
    artifacts: list[LiveArtifact]


# ---------------------------------------------------------------------------
# Shared query params
# ---------------------------------------------------------------------------

class ArtifactFilters(BaseModel):
    artifact_type: str | None = None
    download_status: str | None = None
    notebook_id: str | None = None
    tag: str | None = None
    search: str | None = None
    limit: int = 50
    offset: int = 0


class LibraryFilters(BaseModel):
    source_type: str | None = None
    file_ext: str | None = None
    collection: str | None = None
    tag: str | None = None
    search: str | None = None
    limit: int = 50
    offset: int = 0
