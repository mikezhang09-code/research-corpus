"""Integration test: verify local LivingDocsAPI matches MCP server behavior.

This test uses a mock sources API to simulate the same flow the MCP worker
performs, validating that our local registry produces identical outputs.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from notebooklm._living_docs import (
    LivingDocsAPI,
)
from notebooklm.types import Source

# --- Fixtures matching real MCP server data ---

REAL_NOTEBOOK_ID = "8b4e18ab-a101-4be7-b55b-35b6cd995af4"
REAL_GOOGLE_DOC_SOURCES = [
    {
        "source_id": "0d81ddc2-4995-490f-becc-23efeff25177",
        "title": "CASE STRATEGY MASTER: Nguyen v",
        "type": "google_docs",
        "is_fresh": True,
    },
    {
        "source_id": "c673fbc2-145e-4828-8df4-0595d6d6059b",
        "title": "Discovery Master Timeline - Nguyen v. Fay 2007-2026 (Court Ready)",
        "type": "google_docs",
        "is_fresh": True,
    },
    {
        "source_id": "a488081a-b7e5-4370-bc74-5b255f9d28a6",
        "title": "Complete Nguyen v. Fay Litigation Log & Strategy Analysis",
        "type": "google_docs",
        "is_fresh": True,
    },
]

MCP_TEMPLATES = [
    "violations-master",
    "chain-of-title",
    "timeline-master",
    "damages-calculations",
    "discovery-tracker",
    "evidence-index",
    "defendant-profiles",
    "filing-strategy",
]


@pytest.fixture(autouse=True)
def temp_registry(tmp_path, monkeypatch):
    """Use a temporary registry file."""
    registry_path = tmp_path / "living_docs.json"
    monkeypatch.setattr(
        "notebooklm._living_docs._get_registry_path",
        lambda: registry_path,
    )
    return registry_path


@pytest.fixture
def mock_sources_api():
    """Mock SourcesAPI that simulates real Google Docs source behavior."""
    api = AsyncMock()

    def make_source(drive_file_id):
        # Simulate add_drive returning a Source object
        for src in REAL_GOOGLE_DOC_SOURCES:
            if src["source_id"] == drive_file_id:
                return Source(id=src["source_id"], title=src["title"])
        return Source(id=drive_file_id, title="Unknown")

    api.add_drive = AsyncMock(side_effect=lambda nb_id, fid, title, mime: make_source(fid))
    api.refresh = AsyncMock(return_value=True)
    api.check_freshness = AsyncMock(return_value=True)  # default: fresh
    return api


@pytest.fixture
def api(mock_sources_api):
    core = MagicMock()
    return LivingDocsAPI(core, sources_api=mock_sources_api)


class TestMCPParity:
    """Verify our local living docs match MCP server behavior."""

    def test_templates_match_mcp(self, api):
        """Our templates should match the MCP worker's template list."""
        templates = api.templates()
        assert sorted(templates.keys()) == sorted(MCP_TEMPLATES)

    def test_list_empty_matches_mcp(self, api):
        """Empty list should match MCP's empty response."""
        docs = api.list()
        assert len(docs) == 0
        # MCP returns: {"documents": [], "count": 0, "templates": [...]}

    @pytest.mark.asyncio
    async def test_register_matches_mcp(self, api):
        """Register should create a doc entry like MCP's register."""
        doc = await api.register(
            drive_file_id="drive_file_abc123",
            notebook_id=REAL_NOTEBOOK_ID,
            title="Case Strategy Master",
        )

        # MCP returns: {"success": true, "drive_file_id": "...", "title": "...", ...}
        assert doc.drive_file_id == "drive_file_abc123"
        assert doc.notebook_id == REAL_NOTEBOOK_ID
        assert doc.title == "Case Strategy Master"
        assert doc.source_id is not None  # Should have been added to notebook

    @pytest.mark.asyncio
    async def test_register_list_roundtrip(self, api):
        """Register then list should return the same doc."""
        await api.register(
            drive_file_id="file_1",
            notebook_id=REAL_NOTEBOOK_ID,
            title="Timeline",
            template="timeline-master",
        )
        await api.register(
            drive_file_id="file_2",
            notebook_id=REAL_NOTEBOOK_ID,
            title="Evidence",
            template="evidence-index",
        )

        docs = api.list()
        assert len(docs) == 2
        # MCP returns: {"documents": [...], "count": 2, "templates": [...]}
        assert docs[0].drive_file_id == "file_1"
        assert docs[0].template == "timeline-master"
        assert docs[1].drive_file_id == "file_2"
        assert docs[1].template == "evidence-index"

    @pytest.mark.asyncio
    async def test_check_stale_all_fresh(self, api, mock_sources_api):
        """All fresh docs should match MCP's stale_count=0 response."""
        mock_sources_api.check_freshness = AsyncMock(return_value=True)

        await api.register(
            drive_file_id="file_1",
            notebook_id=REAL_NOTEBOOK_ID,
            title="Doc 1",
        )

        result = await api.check_stale()
        # MCP returns: {"stale": [], "stale_count": 0, "fresh": [...], "fresh_count": 1, ...}
        assert result.stale_count == 0
        assert result.fresh_count == 1
        assert result.total_documents == 1

    @pytest.mark.asyncio
    async def test_check_stale_mixed(self, api, mock_sources_api):
        """Mixed stale/fresh should report correctly."""
        await api.register(
            drive_file_id="fresh_doc",
            notebook_id=REAL_NOTEBOOK_ID,
            title="Fresh",
        )
        await api.register(
            drive_file_id="stale_doc",
            notebook_id=REAL_NOTEBOOK_ID,
            title="Stale",
        )

        # Make check_freshness return False for stale_doc's source_id
        docs = api.list()
        stale_source_id = docs[1].source_id

        async def freshness_check(nb_id, source_id):
            return source_id != stale_source_id

        mock_sources_api.check_freshness = AsyncMock(side_effect=freshness_check)

        result = await api.check_stale()
        assert result.stale_count == 1
        assert result.fresh_count == 1
        assert result.stale[0].title == "Stale"

    @pytest.mark.asyncio
    async def test_sync_refreshes_stale(self, api, mock_sources_api):
        """Sync should refresh stale docs and skip fresh ones."""
        await api.register(
            drive_file_id="stale_doc",
            notebook_id=REAL_NOTEBOOK_ID,
            title="Stale Doc",
        )

        mock_sources_api.check_freshness = AsyncMock(return_value=False)

        result = await api.sync_all()
        assert result.synced_count == 1
        assert result.synced[0].title == "Stale Doc"
        assert result.synced[0].last_synced_at is not None
        mock_sources_api.refresh.assert_called_once()

    @pytest.mark.asyncio
    async def test_remove_matches_mcp(self, api):
        """Remove should match MCP's remove behavior."""
        await api.register(
            drive_file_id="file_1",
            notebook_id=REAL_NOTEBOOK_ID,
            title="To Remove",
        )

        # MCP returns: {"success": true, "removed": true, "remaining": 0}
        removed = api.remove("file_1")
        assert removed is True

        docs = api.list()
        assert len(docs) == 0

    @pytest.mark.asyncio
    async def test_remove_nonexistent_matches_mcp(self, api):
        """Remove nonexistent should return false."""
        removed = api.remove("nonexistent")
        assert removed is False

    @pytest.mark.asyncio
    async def test_full_lifecycle(self, api, mock_sources_api):
        """Full lifecycle: register -> list -> check -> sync -> remove."""
        # 1. Register
        doc = await api.register(
            drive_file_id="lifecycle_doc",
            notebook_id=REAL_NOTEBOOK_ID,
            title="Lifecycle Test",
            template="timeline-master",
        )
        assert doc.source_id is not None

        # 2. List
        docs = api.list()
        assert len(docs) == 1

        # 3. Check (fresh)
        mock_sources_api.check_freshness = AsyncMock(return_value=True)
        result = await api.check_stale()
        assert result.fresh_count == 1
        assert result.stale_count == 0

        # 4. Make stale and sync
        mock_sources_api.check_freshness = AsyncMock(return_value=False)
        sync_result = await api.sync_all()
        assert sync_result.synced_count == 1

        # 5. Verify sync updated timestamp
        docs = api.list()
        assert docs[0].last_synced_at is not None

        # 6. Remove
        removed = api.remove("lifecycle_doc")
        assert removed is True
        assert len(api.list()) == 0
