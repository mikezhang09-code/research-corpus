"""Unit tests for SourcesAPI bulk operations."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from notebooklm._sources import SourcesAPI
from notebooklm.types import Source, SourceAddError


@pytest.fixture
def sources_api():
    """Create a SourcesAPI with a mocked core."""
    core = MagicMock()
    return SourcesAPI(core)


# =========================================================================
# add_urls
# =========================================================================


class TestAddUrls:
    """Tests for SourcesAPI.add_urls()."""

    @pytest.mark.asyncio
    async def test_add_urls_success(self, sources_api):
        """All URLs added successfully."""
        src_a = Source(id="a", title="A")
        src_b = Source(id="b", title="B")

        sources_api.add_url = AsyncMock(side_effect=[src_a, src_b])

        result = await sources_api.add_urls("nb1", ["http://a.com", "http://b.com"])

        assert result == [src_a, src_b]
        assert sources_api.add_url.call_count == 2

    @pytest.mark.asyncio
    async def test_add_urls_empty_list(self, sources_api):
        """Empty URL list returns empty result."""
        sources_api.add_url = AsyncMock()

        result = await sources_api.add_urls("nb1", [])

        assert result == []
        sources_api.add_url.assert_not_called()

    @pytest.mark.asyncio
    async def test_add_urls_failure_raises(self, sources_api):
        """Without skip_failures, first error is raised."""
        sources_api.add_url = AsyncMock(
            side_effect=[Source(id="a", title="A"), SourceAddError("http://b.com")]
        )

        with pytest.raises(SourceAddError):
            await sources_api.add_urls("nb1", ["http://a.com", "http://b.com"])

    @pytest.mark.asyncio
    async def test_add_urls_skip_failures(self, sources_api):
        """With skip_failures=True, errors are skipped."""
        src_a = Source(id="a", title="A")
        sources_api.add_url = AsyncMock(side_effect=[src_a, SourceAddError("http://b.com")])

        result = await sources_api.add_urls(
            "nb1", ["http://a.com", "http://b.com"], skip_failures=True
        )

        assert result == [src_a]

    @pytest.mark.asyncio
    async def test_add_urls_all_fail_skip(self, sources_api):
        """With skip_failures=True and all failing, returns empty list."""
        sources_api.add_url = AsyncMock(
            side_effect=[SourceAddError("http://a.com"), SourceAddError("http://b.com")]
        )

        result = await sources_api.add_urls(
            "nb1", ["http://a.com", "http://b.com"], skip_failures=True
        )

        assert result == []


# =========================================================================
# delete_bulk
# =========================================================================


class TestDeleteBulk:
    """Tests for SourcesAPI.delete_bulk()."""

    @pytest.mark.asyncio
    async def test_delete_bulk_success(self, sources_api):
        """All deletions succeed."""
        sources_api.delete = AsyncMock(return_value=True)

        result = await sources_api.delete_bulk("nb1", ["s1", "s2", "s3"])

        assert result == ["s1", "s2", "s3"]
        assert sources_api.delete.call_count == 3

    @pytest.mark.asyncio
    async def test_delete_bulk_empty_list(self, sources_api):
        """Empty list returns empty result."""
        sources_api.delete = AsyncMock()

        result = await sources_api.delete_bulk("nb1", [])

        assert result == []
        sources_api.delete.assert_not_called()

    @pytest.mark.asyncio
    async def test_delete_bulk_partial_failure(self, sources_api):
        """Partial failures are skipped, successful IDs returned."""
        sources_api.delete = AsyncMock(side_effect=[True, RuntimeError("fail"), True])

        result = await sources_api.delete_bulk("nb1", ["s1", "s2", "s3"])

        assert result == ["s1", "s3"]


# =========================================================================
# refresh_bulk
# =========================================================================


class TestRefreshBulk:
    """Tests for SourcesAPI.refresh_bulk()."""

    @pytest.mark.asyncio
    async def test_refresh_bulk_with_ids(self, sources_api):
        """Refresh specific source IDs."""
        sources_api.refresh = AsyncMock(return_value=True)

        result = await sources_api.refresh_bulk("nb1", ["s1", "s2"])

        assert len(result) == 2
        assert result[0].id == "s1"
        assert result[1].id == "s2"
        assert sources_api.refresh.call_count == 2

    @pytest.mark.asyncio
    async def test_refresh_bulk_none_lists_all(self, sources_api):
        """With source_ids=None, lists all sources first."""
        sources_api.list = AsyncMock(
            return_value=[Source(id="x1", title="X1"), Source(id="x2", title="X2")]
        )
        sources_api.refresh = AsyncMock(return_value=True)

        result = await sources_api.refresh_bulk("nb1")

        sources_api.list.assert_called_once_with("nb1")
        assert len(result) == 2
        assert result[0].id == "x1"
        assert result[1].id == "x2"

    @pytest.mark.asyncio
    async def test_refresh_bulk_empty_list(self, sources_api):
        """Empty list returns empty result."""
        sources_api.refresh = AsyncMock()

        result = await sources_api.refresh_bulk("nb1", [])

        assert result == []
        sources_api.refresh.assert_not_called()

    @pytest.mark.asyncio
    async def test_refresh_bulk_none_empty_notebook(self, sources_api):
        """With source_ids=None and empty notebook, returns empty."""
        sources_api.list = AsyncMock(return_value=[])
        sources_api.refresh = AsyncMock()

        result = await sources_api.refresh_bulk("nb1")

        assert result == []
        sources_api.refresh.assert_not_called()

    @pytest.mark.asyncio
    async def test_refresh_bulk_partial_failure(self, sources_api):
        """Partial failures are skipped."""
        sources_api.refresh = AsyncMock(side_effect=[True, RuntimeError("fail")])

        result = await sources_api.refresh_bulk("nb1", ["s1", "s2"])

        assert len(result) == 1
        assert result[0].id == "s1"
