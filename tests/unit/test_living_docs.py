"""Unit tests for the Living Documents API."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from notebooklm._living_docs import (
    LIVING_DOC_TEMPLATES,
    LivingDoc,
    LivingDocsAPI,
    StaleCheckResult,
    SyncResult,
    _get_registry_path,
    _load_registry,
    _save_registry,
)
from notebooklm.rpc import DriveMimeType
from notebooklm.types import Source


@pytest.fixture
def mock_source():
    """Create a mock Source object."""
    return Source(id="src_001", title="Test Doc")


@pytest.fixture
def mock_sources_api(mock_source):
    """Create a mock SourcesAPI."""
    api = AsyncMock()
    api.add_drive = AsyncMock(return_value=mock_source)
    api.refresh = AsyncMock(return_value=True)
    api.check_freshness = AsyncMock(return_value=True)
    return api


@pytest.fixture
def living_docs_api(mock_sources_api):
    """Create a LivingDocsAPI with mocked dependencies."""
    core = MagicMock()
    return LivingDocsAPI(core, sources_api=mock_sources_api)


@pytest.fixture(autouse=True)
def temp_registry(tmp_path, monkeypatch):
    """Use a temporary registry file for all tests."""
    registry_path = tmp_path / "living_docs.json"
    monkeypatch.setattr(
        "notebooklm._living_docs._get_registry_path",
        lambda: registry_path,
    )
    return registry_path


class TestLivingDocDataclass:
    def test_defaults(self):
        doc = LivingDoc(drive_file_id="abc", notebook_id="nb_1")
        assert doc.drive_file_id == "abc"
        assert doc.notebook_id == "nb_1"
        assert doc.source_id is None
        assert doc.mime_type == DriveMimeType.GOOGLE_DOC.value
        assert doc.registered_at  # Should be auto-set

    def test_custom_values(self):
        doc = LivingDoc(
            drive_file_id="abc",
            notebook_id="nb_1",
            title="My Doc",
            template="timeline-master",
        )
        assert doc.title == "My Doc"
        assert doc.template == "timeline-master"


class TestStaleCheckResult:
    def test_counts(self):
        result = StaleCheckResult(
            stale=[LivingDoc(drive_file_id="a", notebook_id="nb1")],
            fresh=[
                LivingDoc(drive_file_id="b", notebook_id="nb2"),
                LivingDoc(drive_file_id="c", notebook_id="nb3"),
            ],
            errors=[{"drive_file_id": "d", "error": "fail"}],
        )
        assert result.stale_count == 1
        assert result.fresh_count == 2
        assert result.total_documents == 4

    def test_empty(self):
        result = StaleCheckResult()
        assert result.stale_count == 0
        assert result.fresh_count == 0
        assert result.total_documents == 0


class TestSyncResult:
    def test_synced_count(self):
        result = SyncResult(
            synced=[LivingDoc(drive_file_id="a", notebook_id="nb1")],
        )
        assert result.synced_count == 1


class TestRegistry:
    def test_load_empty(self, temp_registry):
        assert _load_registry() == []

    def test_save_and_load(self, temp_registry):
        docs = [{"drive_file_id": "abc", "notebook_id": "nb_1"}]
        _save_registry(docs)
        loaded = _load_registry()
        assert len(loaded) == 1
        assert loaded[0]["drive_file_id"] == "abc"

    def test_load_corrupt(self, temp_registry):
        temp_registry.write_text("not json")
        assert _load_registry() == []


class TestLivingDocsAPI:
    def test_list_empty(self, living_docs_api):
        assert living_docs_api.list() == []

    def test_templates(self, living_docs_api):
        templates = living_docs_api.templates()
        assert "timeline-master" in templates
        assert "violations-master" in templates
        assert len(templates) == len(LIVING_DOC_TEMPLATES)

    @pytest.mark.asyncio
    async def test_register(self, living_docs_api, mock_sources_api):
        doc = await living_docs_api.register(
            drive_file_id="file_123",
            notebook_id="nb_456",
            title="My Timeline",
        )
        assert doc.drive_file_id == "file_123"
        assert doc.notebook_id == "nb_456"
        assert doc.title == "My Timeline"
        assert doc.source_id == "src_001"
        assert doc.last_synced_at is not None

        mock_sources_api.add_drive.assert_called_once()

        # Verify persisted
        docs = living_docs_api.list()
        assert len(docs) == 1
        assert docs[0].drive_file_id == "file_123"

    @pytest.mark.asyncio
    async def test_register_no_add(self, living_docs_api, mock_sources_api):
        doc = await living_docs_api.register(
            drive_file_id="file_123",
            notebook_id="nb_456",
            add_to_notebook=False,
        )
        assert doc.source_id is None
        mock_sources_api.add_drive.assert_not_called()

    @pytest.mark.asyncio
    async def test_register_dedup(self, living_docs_api):
        await living_docs_api.register(
            drive_file_id="file_123",
            notebook_id="nb_456",
            title="v1",
        )
        await living_docs_api.register(
            drive_file_id="file_123",
            notebook_id="nb_456",
            title="v2",
        )
        docs = living_docs_api.list()
        assert len(docs) == 1
        assert docs[0].title == "v2"

    def test_remove(self, living_docs_api, temp_registry):
        _save_registry([{"drive_file_id": "abc", "notebook_id": "nb_1"}])
        assert living_docs_api.remove("abc") is True
        assert living_docs_api.list() == []

    def test_remove_not_found(self, living_docs_api):
        assert living_docs_api.remove("nonexistent") is False

    @pytest.mark.asyncio
    async def test_check_stale_fresh(self, living_docs_api, mock_sources_api):
        _save_registry(
            [{"drive_file_id": "abc", "notebook_id": "nb_1", "source_id": "src_1"}]
        )
        mock_sources_api.check_freshness = AsyncMock(return_value=True)

        result = await living_docs_api.check_stale()
        assert result.fresh_count == 1
        assert result.stale_count == 0

    @pytest.mark.asyncio
    async def test_check_stale_stale(self, living_docs_api, mock_sources_api):
        _save_registry(
            [{"drive_file_id": "abc", "notebook_id": "nb_1", "source_id": "src_1"}]
        )
        mock_sources_api.check_freshness = AsyncMock(return_value=False)

        result = await living_docs_api.check_stale()
        assert result.stale_count == 1
        assert result.fresh_count == 0

    @pytest.mark.asyncio
    async def test_check_stale_no_source_id(self, living_docs_api):
        _save_registry([{"drive_file_id": "abc", "notebook_id": "nb_1"}])

        result = await living_docs_api.check_stale()
        assert len(result.errors) == 1
        assert "No source_id" in result.errors[0]["error"]

    @pytest.mark.asyncio
    async def test_sync_all(self, living_docs_api, mock_sources_api):
        _save_registry(
            [{"drive_file_id": "abc", "notebook_id": "nb_1", "source_id": "src_1"}]
        )
        mock_sources_api.check_freshness = AsyncMock(return_value=False)

        result = await living_docs_api.sync_all()
        assert result.synced_count == 1
        mock_sources_api.refresh.assert_called_once_with("nb_1", "src_1")

    @pytest.mark.asyncio
    async def test_sync_all_skips_fresh(self, living_docs_api, mock_sources_api):
        _save_registry(
            [{"drive_file_id": "abc", "notebook_id": "nb_1", "source_id": "src_1"}]
        )
        mock_sources_api.check_freshness = AsyncMock(return_value=True)

        result = await living_docs_api.sync_all()
        assert result.synced_count == 0
        assert len(result.skipped) == 1
        mock_sources_api.refresh.assert_not_called()

    @pytest.mark.asyncio
    async def test_add_to_notebook(self, living_docs_api, mock_sources_api):
        doc = await living_docs_api.add_to_notebook("file_123", "nb_456")
        assert doc.source_id == "src_001"
        mock_sources_api.add_drive.assert_called_once()
