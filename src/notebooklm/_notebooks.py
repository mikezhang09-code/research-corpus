"""Notebook operations API."""

from __future__ import annotations

import asyncio
import builtins
import logging
from collections import Counter
from typing import TYPE_CHECKING, Any

from ._core import ClientCore
from .rpc import RPCMethod
from .types import Notebook, NotebookDescription, NotebookHealth, SuggestedTopic

if TYPE_CHECKING:
    from ._sources import SourcesAPI

logger = logging.getLogger(__name__)


class NotebooksAPI:
    """Operations on NotebookLM notebooks.

    Provides methods for listing, creating, getting, deleting, and renaming
    notebooks, as well as getting AI-generated descriptions.

    Usage:
        async with NotebookLMClient.from_storage() as client:
            notebooks = await client.notebooks.list()
            new_nb = await client.notebooks.create("My Research")
            await client.notebooks.rename(new_nb.id, "Better Title")
    """

    def __init__(self, core: ClientCore, sources_api: SourcesAPI | None = None):
        """Initialize the notebooks API.

        Args:
            core: The core client infrastructure.
            sources_api: Optional sources API for health checks.
        """
        self._core = core
        self._sources: SourcesAPI | None = sources_api

    async def list(self) -> list[Notebook]:
        """List all notebooks.

        Returns:
            List of Notebook objects.
        """
        logger.debug("Listing notebooks")
        params = [None, 1, None, [2]]
        result = await self._core.rpc_call(RPCMethod.LIST_NOTEBOOKS, params)

        if result and isinstance(result, list) and len(result) > 0:
            raw_notebooks = result[0] if isinstance(result[0], list) else result
            return [Notebook.from_api_response(nb) for nb in raw_notebooks]
        return []

    async def create(self, title: str) -> Notebook:
        """Create a new notebook.

        Args:
            title: The title for the new notebook.

        Returns:
            The created Notebook object.
        """
        logger.debug("Creating notebook: %s", title)
        params = [title, None, None, [2], [1]]
        result = await self._core.rpc_call(RPCMethod.CREATE_NOTEBOOK, params)
        notebook = Notebook.from_api_response(result)
        logger.debug("Created notebook: %s", notebook.id)
        return notebook

    async def get(self, notebook_id: str) -> Notebook:
        """Get notebook details.

        Args:
            notebook_id: The notebook ID.

        Returns:
            Notebook object with details.
        """
        params = [notebook_id, None, [2], None, 0]
        result = await self._core.rpc_call(
            RPCMethod.GET_NOTEBOOK,
            params,
            source_path=f"/notebook/{notebook_id}",
        )
        # get_notebook returns [nb_info, ...] where nb_info contains the notebook data
        nb_info = result[0] if result and isinstance(result, list) and len(result) > 0 else []
        return Notebook.from_api_response(nb_info)

    async def delete(self, notebook_id: str) -> bool:
        """Delete a notebook.

        Args:
            notebook_id: The notebook ID to delete.

        Returns:
            True if deletion succeeded.
        """
        logger.debug("Deleting notebook: %s", notebook_id)
        params = [[notebook_id], [2]]
        await self._core.rpc_call(RPCMethod.DELETE_NOTEBOOK, params)
        return True

    async def rename(self, notebook_id: str, new_title: str) -> Notebook:
        """Rename a notebook.

        Args:
            notebook_id: The notebook ID.
            new_title: The new title for the notebook.

        Returns:
            The renamed Notebook object (fetched after rename).
        """
        logger.debug("Renaming notebook %s to: %s", notebook_id, new_title)
        # Payload format discovered via browser traffic capture:
        # [notebook_id, [[null, null, null, [null, new_title]]]]
        params = [notebook_id, [[None, None, None, [None, new_title]]]]
        await self._core.rpc_call(
            RPCMethod.RENAME_NOTEBOOK,
            params,
            source_path="/",  # Home page context, not notebook page
            allow_null=True,
        )
        # Fetch and return the updated notebook
        return await self.get(notebook_id)

    async def get_summary(self, notebook_id: str) -> str:
        """Get raw summary text for a notebook.

        For parsed summary with topics, use get_description() instead.

        Args:
            notebook_id: The notebook ID.

        Returns:
            Raw summary text string.
        """
        params = [notebook_id, [2]]
        result = await self._core.rpc_call(
            RPCMethod.SUMMARIZE,
            params,
            source_path=f"/notebook/{notebook_id}",
        )
        # Response structure: [[[summary_string, ...], topics, ...]]
        # Summary is at result[0][0][0]
        try:
            if result and isinstance(result, list):
                summary = result[0][0][0]
                return str(summary) if summary else ""
        except (IndexError, TypeError):
            pass
        return ""

    async def get_description(self, notebook_id: str) -> NotebookDescription:
        """Get AI-generated summary and suggested topics for a notebook.

        This provides a high-level overview of what the notebook contains,
        similar to what's shown in the Chat panel when opening a notebook.

        Args:
            notebook_id: The notebook ID.

        Returns:
            NotebookDescription with summary and suggested topics.

        Example:
            desc = await client.notebooks.get_description(notebook_id)
            print(desc.summary)
            for topic in desc.suggested_topics:
                print(f"Q: {topic.question}")
        """
        # Get raw summary data
        params = [notebook_id, [2]]
        result = await self._core.rpc_call(
            RPCMethod.SUMMARIZE,
            params,
            source_path=f"/notebook/{notebook_id}",
        )

        summary = ""
        suggested_topics: list[SuggestedTopic] = []

        # Response structure: [[[summary_string], [[topics]], ...]]
        # Summary is at result[0][0][0], topics at result[0][1][0]
        if result and isinstance(result, list):
            try:
                outer = result[0]

                # Summary at outer[0][0]
                summary_val = outer[0][0]
                summary = str(summary_val) if summary_val else ""

                # Suggested topics at outer[1][0]
                topics_list = outer[1][0]
                if isinstance(topics_list, list):
                    for topic in topics_list:
                        if isinstance(topic, list) and len(topic) >= 2:
                            suggested_topics.append(
                                SuggestedTopic(
                                    question=str(topic[0]) if topic[0] else "",
                                    prompt=str(topic[1]) if topic[1] else "",
                                )
                            )
            except (IndexError, TypeError):
                # A partial result (e.g. summary but no topics) is possible.
                pass

        return NotebookDescription(summary=summary, suggested_topics=suggested_topics)

    async def remove_from_recent(self, notebook_id: str) -> None:
        """Remove a notebook from the recently viewed list.

        Args:
            notebook_id: The notebook ID to remove from recent.
        """
        params = [notebook_id]
        await self._core.rpc_call(
            RPCMethod.REMOVE_RECENTLY_VIEWED,
            params,
            allow_null=True,
        )

    async def get_raw(self, notebook_id: str) -> Any:
        """Get raw notebook data from API.

        This returns the raw API response, useful for accessing data
        not parsed into the Notebook dataclass (like sources list).

        Args:
            notebook_id: The notebook ID.

        Returns:
            Raw API response data.
        """
        params = [notebook_id, None, [2], None, 0]
        return await self._core.rpc_call(
            RPCMethod.GET_NOTEBOOK,
            params,
            source_path=f"/notebook/{notebook_id}",
        )

    async def share(
        self, notebook_id: str, public: bool = True, artifact_id: str | None = None
    ) -> dict:
        """Toggle notebook sharing.

        Note: This method uses SHARE_ARTIFACT for artifact-level sharing.
        For notebook-level sharing with user management, use client.sharing instead:

            await client.sharing.set_public(notebook_id, True)
            await client.sharing.add_user(notebook_id, email, SharePermission.VIEWER)

        Sharing is a NOTEBOOK-LEVEL setting. When enabled, ALL artifacts in the
        notebook become accessible via their URLs.

        Args:
            notebook_id: The notebook ID.
            public: If True, enable sharing. If False, disable sharing.
            artifact_id: Optional artifact ID for generating a deep-link URL.

        Returns:
            Dict with 'public' status, 'url', and 'artifact_id'.
        """
        share_options = [1] if public else [0]
        if artifact_id:
            params = [share_options, notebook_id, artifact_id]
        else:
            params = [share_options, notebook_id]

        await self._core.rpc_call(
            RPCMethod.SHARE_ARTIFACT,
            params,
            source_path=f"/notebook/{notebook_id}",
            allow_null=True,
        )

        # Build share URL
        base_url = f"https://notebooklm.google.com/notebook/{notebook_id}"
        if public and artifact_id:
            url = f"{base_url}?artifactId={artifact_id}"
        elif public:
            url = base_url
        else:
            url = None

        return {
            "public": public,
            "url": url,
            "artifact_id": artifact_id,
        }

    def get_share_url(self, notebook_id: str, artifact_id: str | None = None) -> str:
        """Get share URL for a notebook or artifact.

        This does NOT toggle sharing - it just returns the URL format.
        Use share() to enable/disable sharing.

        Args:
            notebook_id: The notebook ID.
            artifact_id: Optional artifact ID for a deep-link URL.

        Returns:
            The share URL string.
        """
        base_url = f"https://notebooklm.google.com/notebook/{notebook_id}"
        if artifact_id:
            return f"{base_url}?artifactId={artifact_id}"
        return base_url

    async def health(self, notebook_id: str) -> NotebookHealth:
        """Audit notebook health - check for empty, stale sources, duplicates.

        Inspects the notebook's sources and reports:
        - Whether the notebook has any sources at all.
        - Which sources are stale (need refresh), checked via
          ``client.sources.check_freshness()`` when a sources API is available.
        - Which URLs appear more than once across sources.

        Args:
            notebook_id: The notebook ID to audit.

        Returns:
            NotebookHealth report with status, stale sources, and duplicate URLs.

        Raises:
            RuntimeError: If no sources API was provided to the notebooks API.

        Example:
            report = await client.notebooks.health(notebook_id)
            if report.status == "needs_attention":
                print(f"Stale sources: {report.stale_sources}")
                print(f"Duplicate URLs: {report.duplicate_urls}")
        """
        if self._sources is None:
            raise RuntimeError(
                "No sources API available. Use NotebookLMClient which wires "
                "the sources API automatically."
            )

        # Get notebook info and sources in parallel
        notebook, sources = await asyncio.gather(
            self.get(notebook_id),
            self._sources.list(notebook_id),
        )

        source_count = len(sources)
        has_sources = source_count > 0

        if not has_sources:
            return NotebookHealth(
                notebook_id=notebook_id,
                title=notebook.title,
                source_count=0,
                has_sources=False,
                stale_sources=[],
                duplicate_urls=[],
                status="empty",
            )

        # Check freshness for all sources in parallel
        freshness_tasks = [self._sources.check_freshness(notebook_id, src.id) for src in sources]
        freshness_results = await asyncio.gather(*freshness_tasks, return_exceptions=True)

        stale_sources: list[str] = []
        for src, result in zip(sources, freshness_results, strict=False):
            if isinstance(result, Exception):
                # If freshness check fails, flag as stale to be safe
                stale_sources.append(src.id)
            elif result is False:
                stale_sources.append(src.id)

        # Find duplicate URLs
        url_counts: Counter[str] = Counter()
        for src in sources:
            if src.url:
                url_counts[src.url] += 1
        duplicate_urls = [url for url, count in url_counts.items() if count > 1]

        # Determine status
        status = "needs_attention" if stale_sources or duplicate_urls else "healthy"

        return NotebookHealth(
            notebook_id=notebook_id,
            title=notebook.title,
            source_count=source_count,
            has_sources=True,
            stale_sources=stale_sources,
            duplicate_urls=duplicate_urls,
            status=status,
        )

    async def merge(
        self,
        source_notebook_id: str,
        target_notebook_id: str,
        *,
        skip_duplicates: bool = True,
    ) -> builtins.list[Any]:
        """Copy all sources from one notebook to another.

        Reads sources from the source notebook, fetches their full text content,
        and adds each as a text source to the target notebook. URL sources are
        re-added by URL; text-only sources are copied as text.

        Args:
            source_notebook_id: The notebook to copy sources from.
            target_notebook_id: The notebook to copy sources into.
            skip_duplicates: If True, skip sources whose title already exists
                in the target notebook (default: True).

        Returns:
            List of newly created Source objects in the target notebook.

        Raises:
            RuntimeError: If no sources API was provided to the notebooks API.

        Example:
            merged = await client.notebooks.merge(src_id, dst_id)
            print(f"Copied {len(merged)} sources")
        """
        if self._sources is None:
            raise RuntimeError(
                "No sources API available. Use NotebookLMClient which wires "
                "the sources API automatically."
            )

        src_sources = await self._sources.list(source_notebook_id)
        if not src_sources:
            return []

        # Get existing titles in target for dedup
        existing_titles: set[str] = set()
        existing_urls: set[str] = set()
        if skip_duplicates:
            target_sources = await self._sources.list(target_notebook_id)
            existing_titles = {s.title for s in target_sources if s.title}
            existing_urls = {s.url for s in target_sources if s.url}

        added: builtins.list[Any] = []
        for src in src_sources:
            # Skip duplicates by title or URL
            if skip_duplicates:
                if src.title and src.title in existing_titles:
                    logger.debug("Skipping duplicate (title): %s", src.title)
                    continue
                if src.url and src.url in existing_urls:
                    logger.debug("Skipping duplicate (URL): %s", src.url)
                    continue

            try:
                if src.url:
                    new_source = await self._sources.add_url(
                        target_notebook_id, src.url, skip_dedup=True
                    )
                else:
                    # For text-only sources, fetch content and re-add
                    fulltext = await self._sources.get_fulltext(source_notebook_id, src.id)
                    new_source = await self._sources.add_text(
                        target_notebook_id,
                        src.title or "Untitled",
                        fulltext.content or "",
                        skip_dedup=True,
                    )
                added.append(new_source)
                logger.debug("Merged source: %s", src.title)
            except Exception:
                logger.warning("Failed to merge source %s (%s)", src.id, src.title, exc_info=True)

        return added

    async def health_all(self) -> builtins.list[NotebookHealth]:
        """Run health checks on all notebooks in parallel.

        Lists all notebooks and then runs ``health()`` on each one concurrently.

        Returns:
            List of NotebookHealth reports, one per notebook.

        Raises:
            RuntimeError: If no sources API was provided to the notebooks API.

        Example:
            reports = await client.notebooks.health_all()
            for report in reports:
                print(f"{report.title}: {report.status}")
        """
        notebooks = await self.list()
        if not notebooks:
            return []

        tasks = [self.health(nb.id) for nb in notebooks]
        return list(await asyncio.gather(*tasks))
