from __future__ import annotations

from datetime import datetime
from enum import Enum
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
    hidden: bool = False
    cover_emoji: str | None = None


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
# Notebook create + source add
# ---------------------------------------------------------------------------


class NotebookCreateRequest(BaseModel):
    title: str
    cover_emoji: str | None = None


class NotebookRenameRequest(BaseModel):
    title: str | None = None
    cover_emoji: str | None = None


class SourceUrlRequest(BaseModel):
    url: str


class SourceTextRequest(BaseModel):
    title: str
    content: str


class SourceRead(BaseModel):
    """Live source state from the NLM API."""

    id: str
    title: str | None = None
    url: str | None = None
    kind: str  # SourceType enum value, e.g. "pdf", "youtube", "web_page"
    status: int  # 1=processing, 2=ready, 3=error
    is_ready: bool
    is_processing: bool
    is_error: bool
    created_at: datetime | None = None


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
    video_style: str | None = (
        None  # auto | classic | whiteboard | kawaii | anime | watercolor | retro-print | heritage | paper-craft
    )
    # report
    report_format: str | None = None  # briefing-doc | study-guide | blog-post | custom
    # slide_deck
    deck_format: str | None = None  # detailed | presenter
    deck_length: str | None = None  # default | short
    # quiz / flashcards
    quiz_quantity: str | None = None  # fewer | standard | more
    quiz_difficulty: str | None = None  # easy | medium | hard
    # infographic
    info_orientation: str | None = None  # landscape | portrait | square
    info_detail: str | None = None  # concise | standard | detailed
    info_style: str | None = (
        None  # auto | sketch-note | professional | bento-grid | editorial | instructional | bricks | clay | anime | kawaii | scientific
    )


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
    # True when the saved row is no longer present in NotebookLM
    # (i.e., the user deleted the source artifact in Google's UI but we still
    # have the file in R2). UI can show "Only in portal" to clarify state.
    only_in_portal: bool = False


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


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------


class ChatRequest(BaseModel):
    question: str
    conversation_id: str | None = None
    source_ids: list[str] | None = None
    language: str | None = None  # "en" | "zh"; user's preferred output language


class ChatReferenceRead(BaseModel):
    source_id: str
    citation_number: int | None = None
    cited_text: str | None = None


class ChatResponse(BaseModel):
    answer: str
    conversation_id: str
    turn_number: int
    is_follow_up: bool
    references: list[ChatReferenceRead] = []


class ChatTurn(BaseModel):
    question: str
    answer: str


class ChatHistoryResponse(BaseModel):
    turns: list[ChatTurn]
    conversation_id: str | None = None


# ---------------------------------------------------------------------------
# Notebook description (AI summary + suggested topics)
# ---------------------------------------------------------------------------


class SuggestedTopicRead(BaseModel):
    question: str
    prompt: str


class NotebookDescriptionResponse(BaseModel):
    summary: str
    suggested_topics: list[SuggestedTopicRead] = []


# ---------------------------------------------------------------------------
# Web research / "Discover sources"
# ---------------------------------------------------------------------------


class ResearchStartRequest(BaseModel):
    query: str
    source: str = "web"  # "web" or "drive"
    mode: str = "fast"  # "fast" or "deep"


class ResearchStartResponse(BaseModel):
    task_id: str


class ResearchSource(BaseModel):
    url: str = ""
    title: str = ""
    result_type: int | None = None
    research_task_id: str | None = None


class ResearchStatusResponse(BaseModel):
    status: str  # "in_progress" | "completed" | "no_research"
    query: str = ""
    task_id: str | None = None
    summary: str = ""
    sources: list[ResearchSource] = []


class ResearchImportRequest(BaseModel):
    task_id: str
    sources: list[ResearchSource]


# ---------------------------------------------------------------------------
# Library Notebooks
# ---------------------------------------------------------------------------


class LibraryNotebookRead(BaseModel):
    id: UUID
    title: str
    description: str
    cover_emoji: str | None
    hidden: bool
    tags: list[str] = Field(default_factory=list)
    file_count: int = 0
    created_at: datetime
    updated_at: datetime


class LibraryNotebookCreate(BaseModel):
    title: str
    cover_emoji: str | None = None
    tags: list[str] = Field(default_factory=list)


class LibraryNotebookUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    cover_emoji: str | None = None
    tags: list[str] | None = None


class LibraryFileRead(BaseModel):
    id: UUID
    title: str
    description: str
    original_name: str
    mime_type: str | None
    file_ext: str | None
    file_category: str
    r2_key: str | None
    r2_url: str | None
    file_size_bytes: int | None
    notebook_id: UUID
    added_at: datetime
    last_modified: datetime | None


class LibraryFileUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    file_category: str | None = None


class LibraryFileBulkRequest(BaseModel):
    file_ids: list[UUID]


class FreeFormFileRead(BaseModel):
    """A standalone library file that belongs to no folio (notebook_id IS NULL)."""

    id: UUID
    title: str
    description: str
    original_name: str
    mime_type: str | None
    file_ext: str | None
    file_category: str
    r2_key: str | None
    r2_url: str | None
    file_size_bytes: int | None
    tags: list[str] = Field(default_factory=list)
    added_at: datetime
    last_modified: datetime | None


class FreeFormFileUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    file_category: str | None = None
    tags: list[str] | None = None


class LibraryFilesNewNotebookRequest(BaseModel):
    title: str
    cover_emoji: str | None = None
    tags: list[str] = Field(default_factory=list)
    file_ids: list[UUID]


class LibraryFileContentUpdate(BaseModel):
    content: str


class LibraryNotebookListResponse(BaseModel):
    items: list[LibraryNotebookRead]
    total: int


class LibraryChatRequest(BaseModel):
    message: str
    language: str | None = None  # "en" | "zh"; user's preferred output language


class GenerateDescriptionRequest(BaseModel):
    language: str | None = None  # "en" | "zh"; user's preferred output language


class GenerateDescriptionResponse(BaseModel):
    description: str


class GenerateArtifactRequest(BaseModel):
    kind: str  # "note" | "mindmap" | "quiz" | "flashcards"
    language: str | None = None  # "en" | "zh"; user's preferred output language


# ---------------------------------------------------------------------------
# Push Folio files → NotebookLM notebook
# ---------------------------------------------------------------------------


class PushToCorpusRequest(BaseModel):
    """Push a subset of a folio's files into a NotebookLM notebook as sources.

    Either target an existing notebook via `target_notebook_id`, or omit it to
    create a new notebook (then `new_title` is required).
    """

    file_ids: list[UUID]
    target_notebook_id: str | None = None
    new_title: str | None = None
    new_cover_emoji: str | None = None


class PushFileResult(BaseModel):
    file_id: UUID
    title: str
    status: str  # "pushed" | "skipped" | "error"
    reason: str = ""
    source_id: str | None = None


class PushToCorpusResponse(BaseModel):
    notebook_id: str
    notebook_title: str
    results: list[PushFileResult]
