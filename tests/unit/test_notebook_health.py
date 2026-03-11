"""Tests for NotebooksAPI.health() and health_all() methods."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from notebooklm._notebooks import NotebooksAPI
from notebooklm.types import Notebook, NotebookHealth, Source


@pytest.fixture
def mock_core():
    """Create a mock ClientCore."""
    return MagicMock()


@pytest.fixture
def mock_sources():
    """Create a mock SourcesAPI."""
    sources = AsyncMock()
    return sources


@pytest.fixture
def notebooks_api(mock_core, mock_sources):
    """Create a NotebooksAPI with mocked dependencies."""
    return NotebooksAPI(mock_core, sources_api=mock_sources)


@pytest.fixture
def notebooks_api_no_sources(mock_core):
    """Create a NotebooksAPI without a sources API."""
    return NotebooksAPI(mock_core)


# =============================================================================
# NotebookHealth DATACLASS TESTS
# =============================================================================


class TestNotebookHealthDataclass:
    def test_default_values(self):
        """Test NotebookHealth has correct defaults."""
        health = NotebookHealth(
            notebook_id="nb-1",
            title="Test",
            source_count=0,
            has_sources=False,
        )
        assert health.stale_sources == []
        assert health.duplicate_urls == []
        assert health.status == "healthy"

    def test_all_fields(self):
        """Test NotebookHealth with all fields set."""
        health = NotebookHealth(
            notebook_id="nb-1",
            title="Test",
            source_count=3,
            has_sources=True,
            stale_sources=["src-1", "src-2"],
            duplicate_urls=["https://example.com"],
            status="needs_attention",
        )
        assert health.notebook_id == "nb-1"
        assert health.title == "Test"
        assert health.source_count == 3
        assert health.has_sources is True
        assert len(health.stale_sources) == 2
        assert len(health.duplicate_urls) == 1
        assert health.status == "needs_attention"


# =============================================================================
# health() METHOD TESTS
# =============================================================================


class TestNotebookHealth:
    @pytest.mark.asyncio
    async def test_health_no_sources_api_raises(self, notebooks_api_no_sources):
        """Test health() raises RuntimeError when no sources API is available."""
        with pytest.raises(RuntimeError, match="No sources API available"):
            await notebooks_api_no_sources.health("nb-1")

    @pytest.mark.asyncio
    async def test_health_empty_notebook(self, notebooks_api, mock_sources):
        """Test health() returns 'empty' status for notebook with no sources."""
        notebooks_api.get = AsyncMock(return_value=Notebook(id="nb-1", title="Empty Notebook"))
        mock_sources.list.return_value = []

        result = await notebooks_api.health("nb-1")

        assert result.notebook_id == "nb-1"
        assert result.title == "Empty Notebook"
        assert result.source_count == 0
        assert result.has_sources is False
        assert result.stale_sources == []
        assert result.duplicate_urls == []
        assert result.status == "empty"

    @pytest.mark.asyncio
    async def test_health_healthy_notebook(self, notebooks_api, mock_sources):
        """Test health() returns 'healthy' for a good notebook."""
        notebooks_api.get = AsyncMock(return_value=Notebook(id="nb-1", title="Good Notebook"))
        mock_sources.list.return_value = [
            Source(id="src-1", title="Source 1", url="https://example.com"),
            Source(id="src-2", title="Source 2", url="https://other.com"),
        ]
        # All sources are fresh
        mock_sources.check_freshness.return_value = True

        result = await notebooks_api.health("nb-1")

        assert result.status == "healthy"
        assert result.source_count == 2
        assert result.has_sources is True
        assert result.stale_sources == []
        assert result.duplicate_urls == []

    @pytest.mark.asyncio
    async def test_health_stale_sources(self, notebooks_api, mock_sources):
        """Test health() detects stale sources."""
        notebooks_api.get = AsyncMock(return_value=Notebook(id="nb-1", title="Stale Notebook"))
        mock_sources.list.return_value = [
            Source(id="src-1", title="Fresh Source"),
            Source(id="src-2", title="Stale Source"),
        ]
        # First source fresh, second stale
        mock_sources.check_freshness.side_effect = [True, False]

        result = await notebooks_api.health("nb-1")

        assert result.status == "needs_attention"
        assert result.stale_sources == ["src-2"]

    @pytest.mark.asyncio
    async def test_health_freshness_check_exception(self, notebooks_api, mock_sources):
        """Test health() flags sources as stale when freshness check fails."""
        notebooks_api.get = AsyncMock(return_value=Notebook(id="nb-1", title="Error Notebook"))
        mock_sources.list.return_value = [
            Source(id="src-1", title="Error Source"),
        ]
        # Freshness check throws an exception
        mock_sources.check_freshness.side_effect = Exception("API error")

        result = await notebooks_api.health("nb-1")

        assert result.status == "needs_attention"
        assert result.stale_sources == ["src-1"]

    @pytest.mark.asyncio
    async def test_health_duplicate_urls(self, notebooks_api, mock_sources):
        """Test health() detects duplicate URLs."""
        notebooks_api.get = AsyncMock(return_value=Notebook(id="nb-1", title="Dupes Notebook"))
        mock_sources.list.return_value = [
            Source(id="src-1", title="Source 1", url="https://example.com"),
            Source(id="src-2", title="Source 2", url="https://example.com"),
            Source(id="src-3", title="Source 3", url="https://unique.com"),
        ]
        mock_sources.check_freshness.return_value = True

        result = await notebooks_api.health("nb-1")

        assert result.status == "needs_attention"
        assert result.duplicate_urls == ["https://example.com"]
        assert result.stale_sources == []

    @pytest.mark.asyncio
    async def test_health_sources_without_urls_no_duplicates(self, notebooks_api, mock_sources):
        """Test health() ignores sources without URLs for duplicate check."""
        notebooks_api.get = AsyncMock(return_value=Notebook(id="nb-1", title="Text Notebook"))
        mock_sources.list.return_value = [
            Source(id="src-1", title="Text Source 1", url=None),
            Source(id="src-2", title="Text Source 2", url=None),
        ]
        mock_sources.check_freshness.return_value = True

        result = await notebooks_api.health("nb-1")

        assert result.status == "healthy"
        assert result.duplicate_urls == []

    @pytest.mark.asyncio
    async def test_health_stale_and_duplicates(self, notebooks_api, mock_sources):
        """Test health() reports needs_attention when both issues exist."""
        notebooks_api.get = AsyncMock(return_value=Notebook(id="nb-1", title="Bad Notebook"))
        mock_sources.list.return_value = [
            Source(id="src-1", title="Source 1", url="https://example.com"),
            Source(id="src-2", title="Source 2", url="https://example.com"),
        ]
        # First fresh, second stale
        mock_sources.check_freshness.side_effect = [True, False]

        result = await notebooks_api.health("nb-1")

        assert result.status == "needs_attention"
        assert result.stale_sources == ["src-2"]
        assert result.duplicate_urls == ["https://example.com"]


# =============================================================================
# health_all() METHOD TESTS
# =============================================================================


class TestNotebookHealthAll:
    @pytest.mark.asyncio
    async def test_health_all_empty(self, notebooks_api):
        """Test health_all() returns empty list when no notebooks exist."""
        notebooks_api.list = AsyncMock(return_value=[])

        result = await notebooks_api.health_all()

        assert result == []

    @pytest.mark.asyncio
    async def test_health_all_multiple_notebooks(self, notebooks_api, mock_sources):
        """Test health_all() runs health on all notebooks."""
        notebooks_api.list = AsyncMock(
            return_value=[
                Notebook(id="nb-1", title="Notebook 1"),
                Notebook(id="nb-2", title="Notebook 2"),
            ]
        )
        notebooks_api.get = AsyncMock(
            side_effect=lambda nid: Notebook(id=nid, title=f"Notebook {nid[-1]}")
        )
        mock_sources.list.return_value = [
            Source(id="src-1", title="Source 1"),
        ]
        mock_sources.check_freshness.return_value = True

        result = await notebooks_api.health_all()

        assert len(result) == 2
        assert result[0].notebook_id == "nb-1"
        assert result[1].notebook_id == "nb-2"

    @pytest.mark.asyncio
    async def test_health_all_mixed_statuses(self, notebooks_api, mock_sources):
        """Test health_all() with notebooks in different states."""
        notebooks_api.list = AsyncMock(
            return_value=[
                Notebook(id="nb-empty", title="Empty"),
                Notebook(id="nb-good", title="Good"),
            ]
        )

        async def mock_get(nid):
            if nid == "nb-empty":
                return Notebook(id="nb-empty", title="Empty")
            return Notebook(id="nb-good", title="Good")

        notebooks_api.get = AsyncMock(side_effect=mock_get)

        async def mock_list_sources(nid):
            if nid == "nb-empty":
                return []
            return [Source(id="src-1", title="Source 1")]

        mock_sources.list.side_effect = mock_list_sources
        mock_sources.check_freshness.return_value = True

        result = await notebooks_api.health_all()

        assert len(result) == 2
        statuses = {r.notebook_id: r.status for r in result}
        assert statuses["nb-empty"] == "empty"
        assert statuses["nb-good"] == "healthy"


# =============================================================================
# EXPORT TESTS
# =============================================================================


class TestNotebookHealthExport:
    def test_importable_from_notebooklm(self):
        """Test NotebookHealth is importable from the top-level package."""
        from notebooklm import NotebookHealth

        assert NotebookHealth is not None

    def test_importable_from_types(self):
        """Test NotebookHealth is importable from types module."""
        from notebooklm.types import NotebookHealth

        assert NotebookHealth is not None
