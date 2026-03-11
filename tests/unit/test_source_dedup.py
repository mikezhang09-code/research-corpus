"""Unit tests for source deduplication logic."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from notebooklm._sources import SourcesAPI
from notebooklm.types import Source


@pytest.fixture
def sources_api():
    """Create a SourcesAPI with a mocked core."""
    core = MagicMock()
    api = SourcesAPI(core)
    return api


class TestCheckDuplicate:
    """Tests for the _check_duplicate helper method."""

    @pytest.mark.asyncio
    async def test_no_duplicate_url(self, sources_api):
        """Returns None when no source has a matching URL."""
        sources_api.list = AsyncMock(
            return_value=[
                Source(id="s1", title="Page A", url="https://example.com/a"),
                Source(id="s2", title="Page B", url="https://example.com/b"),
            ]
        )
        result = await sources_api._check_duplicate("nb1", url="https://example.com/c")
        assert result is None

    @pytest.mark.asyncio
    async def test_duplicate_url_found(self, sources_api):
        """Returns the existing source when URL matches."""
        existing = Source(id="s1", title="Page A", url="https://example.com/a")
        sources_api.list = AsyncMock(return_value=[existing])
        result = await sources_api._check_duplicate("nb1", url="https://example.com/a")
        assert result is existing

    @pytest.mark.asyncio
    async def test_no_duplicate_title(self, sources_api):
        """Returns None when no source has a matching title."""
        sources_api.list = AsyncMock(
            return_value=[
                Source(id="s1", title="Notes A"),
                Source(id="s2", title="Notes B"),
            ]
        )
        result = await sources_api._check_duplicate("nb1", title="Notes C")
        assert result is None

    @pytest.mark.asyncio
    async def test_duplicate_title_found(self, sources_api):
        """Returns the existing source when title matches."""
        existing = Source(id="s2", title="My Notes")
        sources_api.list = AsyncMock(
            return_value=[
                Source(id="s1", title="Other"),
                existing,
            ]
        )
        result = await sources_api._check_duplicate("nb1", title="My Notes")
        assert result is existing

    @pytest.mark.asyncio
    async def test_empty_notebook(self, sources_api):
        """Returns None when the notebook has no sources."""
        sources_api.list = AsyncMock(return_value=[])
        result = await sources_api._check_duplicate("nb1", url="https://example.com")
        assert result is None

    @pytest.mark.asyncio
    async def test_source_with_none_url_not_matched(self, sources_api):
        """Sources with url=None should not match any URL check."""
        sources_api.list = AsyncMock(return_value=[Source(id="s1", title="Text source", url=None)])
        result = await sources_api._check_duplicate("nb1", url="https://example.com")
        assert result is None

    @pytest.mark.asyncio
    async def test_source_with_none_title_not_matched(self, sources_api):
        """Sources with title=None should not match any title check."""
        sources_api.list = AsyncMock(
            return_value=[Source(id="s1", title=None, url="https://example.com")]
        )
        result = await sources_api._check_duplicate("nb1", title="Some Title")
        assert result is None


class TestAddUrlDedup:
    """Tests for deduplication in add_url."""

    @pytest.mark.asyncio
    async def test_add_url_raises_on_duplicate(self, sources_api):
        """add_url raises ValueError when a duplicate URL exists."""
        sources_api.list = AsyncMock(
            return_value=[
                Source(id="s1", title="Existing Page", url="https://example.com/page"),
            ]
        )
        with pytest.raises(ValueError, match="Duplicate source.*https://example.com/page"):
            await sources_api.add_url("nb1", "https://example.com/page", skip_dedup=False)

    @pytest.mark.asyncio
    async def test_add_url_skip_dedup(self, sources_api):
        """add_url proceeds when skip_dedup=True even if duplicate exists."""
        sources_api.list = AsyncMock(
            return_value=[
                Source(id="s1", title="Existing Page", url="https://example.com/page"),
            ]
        )
        # Mock the internal methods to avoid actual RPC calls
        sources_api._add_url_source = AsyncMock(
            return_value=[[["new_id"], "Existing Page", [None, None, None, None, None]]]
        )
        sources_api._extract_youtube_video_id = MagicMock(return_value=None)

        result = await sources_api.add_url("nb1", "https://example.com/page", skip_dedup=True)
        assert result.id == "new_id"
        # list should not have been called since we skip dedup
        # (list was set up but _check_duplicate should not be called)

    @pytest.mark.asyncio
    async def test_add_url_no_duplicate_proceeds(self, sources_api):
        """add_url proceeds normally when no duplicate found."""
        sources_api.list = AsyncMock(return_value=[])
        sources_api._add_url_source = AsyncMock(
            return_value=[[["new_id"], "New Page", [None, None, None, None, None]]]
        )
        sources_api._extract_youtube_video_id = MagicMock(return_value=None)

        result = await sources_api.add_url("nb1", "https://example.com/new", skip_dedup=False)
        assert result.id == "new_id"

    @pytest.mark.asyncio
    async def test_add_url_error_message_includes_source_info(self, sources_api):
        """ValueError message includes existing source ID and title."""
        sources_api.list = AsyncMock(
            return_value=[
                Source(id="src-abc-123", title="My Article", url="https://example.com"),
            ]
        )
        with pytest.raises(ValueError, match="source_id=src-abc-123") as exc_info:
            await sources_api.add_url("nb1", "https://example.com", skip_dedup=False)
        assert "My Article" in str(exc_info.value)
        assert "skip_dedup=True" in str(exc_info.value)


class TestAddTextDedup:
    """Tests for deduplication in add_text."""

    @pytest.mark.asyncio
    async def test_add_text_raises_on_duplicate_title(self, sources_api):
        """add_text raises ValueError when a source with the same title exists."""
        sources_api.list = AsyncMock(
            return_value=[
                Source(id="s1", title="My Notes"),
            ]
        )
        with pytest.raises(ValueError, match="Duplicate source.*My Notes"):
            await sources_api.add_text("nb1", "My Notes", "some content", skip_dedup=False)

    @pytest.mark.asyncio
    async def test_add_text_skip_dedup(self, sources_api):
        """add_text proceeds when skip_dedup=True even if duplicate exists."""
        sources_api.list = AsyncMock(return_value=[Source(id="s1", title="My Notes")])
        # Mock the core rpc_call to return a valid source response
        sources_api._core.rpc_call = AsyncMock(
            return_value=[[["new_id"], "My Notes", [None, None, None, None, None]]]
        )

        result = await sources_api.add_text("nb1", "My Notes", "new content", skip_dedup=True)
        assert result.id == "new_id"

    @pytest.mark.asyncio
    async def test_add_text_no_duplicate_proceeds(self, sources_api):
        """add_text proceeds normally when no duplicate title found."""
        sources_api.list = AsyncMock(return_value=[])
        sources_api._core.rpc_call = AsyncMock(
            return_value=[[["new_id"], "Fresh Notes", [None, None, None, None, None]]]
        )

        result = await sources_api.add_text("nb1", "Fresh Notes", "content", skip_dedup=False)
        assert result.id == "new_id"

    @pytest.mark.asyncio
    async def test_add_text_error_message_includes_source_info(self, sources_api):
        """ValueError message includes existing source ID."""
        sources_api.list = AsyncMock(
            return_value=[
                Source(id="src-xyz-789", title="Research Notes"),
            ]
        )
        with pytest.raises(ValueError, match="source_id=src-xyz-789") as exc_info:
            await sources_api.add_text("nb1", "Research Notes", "content", skip_dedup=False)
        assert "skip_dedup=True" in str(exc_info.value)
