"""Living Documents API - auto-syncing Drive files linked to notebooks.

Living documents are Google Drive files registered to notebooks that can be
monitored for staleness and synced automatically. The registry is stored
locally at ~/.notebooklm/living_docs.json.

Usage:
    async with NotebookLMClient.from_storage() as client:
        # Register a Drive doc linked to a notebook
        doc = await client.living_docs.register(
            drive_file_id="1abc...",
            notebook_id="nb_123",
            title="Master Timeline",
        )

        # Check which docs are stale
        stale = await client.living_docs.check_stale()

        # Sync all stale docs
        results = await client.living_docs.sync_all()
"""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from ._core import ClientCore
from ._sources import SourcesAPI
from .paths import get_home_dir
from .rpc import DriveMimeType

logger = logging.getLogger(__name__)

# Templates matching the MCP worker's living doc templates
LIVING_DOC_TEMPLATES: dict[str, dict] = {
    "violations-master": {
        "title": "Master Violations Register",
        "description": "All legal/regulatory violations with statutes, evidence, and severity",
        "suggested_notebooks": ["violations", "evidence"],
    },
    "chain-of-title": {
        "title": "Chain of Title Analysis",
        "description": "Complete assignment chain, defects, and standing analysis",
        "suggested_notebooks": ["chain of title"],
    },
    "timeline-master": {
        "title": "Master Case Timeline",
        "description": "Chronological events from loan origination to present",
        "suggested_notebooks": ["timeline"],
    },
    "damages-calculations": {
        "title": "Damages & Exposure Calculations",
        "description": "Constitutional forfeiture, statutory damages, actual damages",
        "suggested_notebooks": ["damages", "constitutional"],
    },
    "discovery-tracker": {
        "title": "Discovery Requests & Responses",
        "description": "Interrogatories, RFPs, depositions, and compliance tracking",
        "suggested_notebooks": ["discovery"],
    },
    "evidence-index": {
        "title": "Evidence Index & Exhibit List",
        "description": "All exhibits with descriptions, sources, and authentication status",
        "suggested_notebooks": ["evidence"],
    },
    "defendant-profiles": {
        "title": "Defendant Profiles & Liability",
        "description": "Each defendant's role, actions, and individual liability",
        "suggested_notebooks": ["servicing"],
    },
    "filing-strategy": {
        "title": "Filing Strategy & Court Deadlines",
        "description": "Upcoming deadlines, motion strategy, and filing calendar",
        "suggested_notebooks": ["filing"],
    },
}


@dataclass
class LivingDoc:
    """A registered living document."""

    drive_file_id: str
    notebook_id: str
    source_id: str | None = None
    title: str | None = None
    mime_type: str = DriveMimeType.GOOGLE_DOC.value
    template: str | None = None
    registered_at: str = ""
    last_synced_at: str | None = None

    def __post_init__(self):
        if not self.registered_at:
            self.registered_at = datetime.now(timezone.utc).isoformat()


@dataclass
class StaleCheckResult:
    """Result of checking living docs for staleness."""

    stale: list[LivingDoc] = field(default_factory=list)
    fresh: list[LivingDoc] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)

    @property
    def stale_count(self) -> int:
        return len(self.stale)

    @property
    def fresh_count(self) -> int:
        return len(self.fresh)

    @property
    def total_documents(self) -> int:
        return len(self.stale) + len(self.fresh) + len(self.errors)


@dataclass
class SyncResult:
    """Result of syncing living documents."""

    synced: list[LivingDoc] = field(default_factory=list)
    skipped: list[LivingDoc] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)

    @property
    def synced_count(self) -> int:
        return len(self.synced)


def _get_registry_path() -> Path:
    """Get the living docs registry file path."""
    return get_home_dir() / "living_docs.json"


def _load_registry() -> list[dict]:
    """Load the living docs registry from disk."""
    path = _get_registry_path()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data.get("documents", [])
    except (json.JSONDecodeError, KeyError):
        logger.warning("Corrupt living_docs.json, starting fresh")
        return []


def _save_registry(docs: list[dict]) -> None:
    """Save the living docs registry to disk."""
    path = _get_registry_path()
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    data = {"documents": docs, "updated_at": datetime.now(timezone.utc).isoformat()}
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def _doc_from_dict(d: dict) -> LivingDoc:
    """Create a LivingDoc from a dict."""
    return LivingDoc(
        drive_file_id=d["drive_file_id"],
        notebook_id=d["notebook_id"],
        source_id=d.get("source_id"),
        title=d.get("title"),
        mime_type=d.get("mime_type", DriveMimeType.GOOGLE_DOC.value),
        template=d.get("template"),
        registered_at=d.get("registered_at", ""),
        last_synced_at=d.get("last_synced_at"),
    )


class LivingDocsAPI:
    """Living Documents API for auto-syncing Drive files with notebooks.

    Living documents are Drive files that you update externally and want
    to keep in sync with NotebookLM notebooks. Register a doc once, then
    use check_stale() and sync_all() to keep everything current.
    """

    def __init__(self, core: ClientCore, sources_api: SourcesAPI) -> None:
        self._core = core
        self._sources = sources_api

    def list(self) -> list[LivingDoc]:
        """List all registered living documents.

        Returns:
            List of registered LivingDoc entries.
        """
        entries = _load_registry()
        return [_doc_from_dict(d) for d in entries]

    def templates(self) -> dict[str, dict]:
        """Get available living document templates.

        Returns:
            Dict mapping template IDs to their metadata.
        """
        return LIVING_DOC_TEMPLATES

    async def register(
        self,
        drive_file_id: str,
        notebook_id: str,
        title: str | None = None,
        mime_type: str = DriveMimeType.GOOGLE_DOC.value,
        template: str | None = None,
        add_to_notebook: bool = True,
    ) -> LivingDoc:
        """Register a Drive file as a living document linked to a notebook.

        Args:
            drive_file_id: Google Drive file ID.
            notebook_id: Notebook to link the document to.
            title: Display title (defaults to Drive filename).
            mime_type: Drive MIME type (default: Google Doc).
            template: Optional template ID for categorization.
            add_to_notebook: If True, also add as a source to the notebook.

        Returns:
            The registered LivingDoc.
        """
        doc = LivingDoc(
            drive_file_id=drive_file_id,
            notebook_id=notebook_id,
            title=title or drive_file_id,
            mime_type=mime_type,
            template=template,
        )

        # Add to notebook as a Drive source
        if add_to_notebook:
            source = await self._sources.add_drive(
                notebook_id,
                drive_file_id,
                doc.title or drive_file_id,
                mime_type,
            )
            doc.source_id = source.id
            doc.last_synced_at = datetime.now(timezone.utc).isoformat()

        # Save to registry
        entries = _load_registry()
        # Remove existing entry for same drive_file_id + notebook_id
        entries = [
            e
            for e in entries
            if not (e["drive_file_id"] == drive_file_id and e["notebook_id"] == notebook_id)
        ]
        entries.append(asdict(doc))
        _save_registry(entries)

        return doc

    async def add_to_notebook(
        self,
        drive_file_id: str,
        notebook_id: str,
    ) -> LivingDoc:
        """Add a Drive file to a notebook and register as a living document.

        Convenience method that combines register + add_to_notebook.

        Args:
            drive_file_id: Google Drive file ID.
            notebook_id: Target notebook ID.

        Returns:
            The registered LivingDoc.
        """
        return await self.register(
            drive_file_id=drive_file_id,
            notebook_id=notebook_id,
            add_to_notebook=True,
        )

    def remove(self, drive_file_id: str) -> bool:
        """Remove a living document from the registry.

        This only removes the tracking entry — it does NOT delete the
        source from NotebookLM or the file from Drive.

        Args:
            drive_file_id: The Drive file ID to unregister.

        Returns:
            True if a document was removed.
        """
        entries = _load_registry()
        original_count = len(entries)
        entries = [e for e in entries if e["drive_file_id"] != drive_file_id]
        if len(entries) < original_count:
            _save_registry(entries)
            return True
        return False

    async def check_stale(self) -> StaleCheckResult:
        """Check which living documents need syncing.

        Uses the source freshness API to determine if each
        registered document has been updated since last sync.

        Returns:
            StaleCheckResult with stale, fresh, and error lists.
        """
        result = StaleCheckResult()
        entries = _load_registry()

        for entry in entries:
            doc = _doc_from_dict(entry)
            if not doc.source_id:
                result.errors.append(
                    {"drive_file_id": doc.drive_file_id, "error": "No source_id registered"}
                )
                continue

            try:
                is_fresh = await self._sources.check_freshness(doc.notebook_id, doc.source_id)
                if is_fresh:
                    result.fresh.append(doc)
                else:
                    result.stale.append(doc)
            except Exception as e:
                logger.warning("Failed to check freshness for %s: %s", doc.drive_file_id, e)
                result.errors.append({"drive_file_id": doc.drive_file_id, "error": str(e)})

        return result

    async def sync_all(self) -> SyncResult:
        """Sync all stale living documents by refreshing their sources.

        Returns:
            SyncResult with synced, skipped, and error lists.
        """
        result = SyncResult()
        stale_check = await self.check_stale()

        # Skip fresh docs
        result.skipped = stale_check.fresh

        # Sync stale docs
        for doc in stale_check.stale:
            if not doc.source_id:
                result.errors.append({"drive_file_id": doc.drive_file_id, "error": "No source_id"})
                continue

            try:
                await self._sources.refresh(doc.notebook_id, doc.source_id)
                doc.last_synced_at = datetime.now(timezone.utc).isoformat()
                result.synced.append(doc)

                # Update registry with new sync time
                self._update_sync_time(doc.drive_file_id, doc.notebook_id, doc.last_synced_at)
            except Exception as e:
                logger.warning("Failed to sync %s: %s", doc.drive_file_id, e)
                result.errors.append({"drive_file_id": doc.drive_file_id, "error": str(e)})

        # Include errors from stale check
        result.errors.extend(stale_check.errors)

        return result

    def _update_sync_time(self, drive_file_id: str, notebook_id: str, synced_at: str) -> None:
        """Update the last_synced_at for a document in the registry."""
        entries = _load_registry()
        for entry in entries:
            if entry["drive_file_id"] == drive_file_id and entry["notebook_id"] == notebook_id:
                entry["last_synced_at"] = synced_at
                break
        _save_registry(entries)
