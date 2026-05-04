"""MCP tool definitions for the NotebookLM MCP Server.

All tools are registered onto the FastMCP instance via register().
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastmcp import FastMCP
from notebooklm.exceptions import SourceNotFoundError, SourceProcessingError, SourceTimeoutError
from notebooklm.rpc.types import source_status_to_str

from .client_service import get_client

logger = logging.getLogger(__name__)


def _serialize_source_status(source: Any) -> dict[str, Any]:
    """Convert a Source object into an MCP-friendly status payload."""
    created_at = source.created_at.isoformat() if source.created_at else None
    return {
        "id": source.id,
        "title": source.title,
        "kind": str(source.kind),
        "status_code": int(source.status),
        "status": source_status_to_str(source.status),
        "is_ready": source.is_ready,
        "is_processing": source.is_processing,
        "is_error": source.is_error,
        "url": source.url,
        "created_at": created_at,
    }


def register(mcp: FastMCP) -> None:
    """Register all MCP tools onto the given FastMCP instance."""

    # ──────────────────────────────────────────────
    # Notebook Management Tools
    # ──────────────────────────────────────────────

    @mcp.tool()
    async def list_notebooks() -> list[dict[str, Any]]:
        """List all available NotebookLM notebooks.

        Returns a list of notebooks with their IDs and titles.
        """
        client = await get_client()
        notebooks = await client.notebooks.list()
        return [{"id": nb.id, "title": nb.title} for nb in notebooks]

    @mcp.tool()
    async def create_notebook(title: str) -> dict[str, Any]:
        """Create a new NotebookLM notebook.

        Args:
            title: The title for the new notebook.

        Returns:
            A dict with the new notebook's 'id' and 'title'.
        """
        client = await get_client()
        notebook = await client.notebooks.create(title)
        logger.info("Created notebook '%s' with id %s", title, notebook.id)
        return {"id": notebook.id, "title": notebook.title}

    @mcp.tool()
    async def delete_notebook(notebook_id: str) -> dict[str, Any]:
        """Delete a NotebookLM notebook.

        Args:
            notebook_id: The ID of the notebook to delete.

        Returns:
            A dict confirming deletion with 'success' and 'notebook_id'.
        """
        client = await get_client()
        await client.notebooks.delete(notebook_id)
        logger.info("Deleted notebook %s", notebook_id)
        return {"success": True, "notebook_id": notebook_id}

    # ──────────────────────────────────────────────
    # Source Management Tools
    # ──────────────────────────────────────────────

    @mcp.tool()
    async def list_sources(notebook_id: str) -> list[dict[str, Any]]:
        """List all sources in a specific notebook.

        Args:
            notebook_id: The ID of the notebook.

        Returns:
            A list of sources with their IDs, titles, and statuses.
        """
        client = await get_client()
        sources = await client.sources.list(notebook_id)
        return [
            {
                "id": src.id,
                "title": src.title,
                "status": str(src.status),
                "kind": str(src.kind),
            }
            for src in sources
        ]

    @mcp.tool()
    async def add_source(notebook_id: str, url: str, wait: bool = True) -> dict[str, Any]:
        """Add a URL source to a NotebookLM notebook.

        Args:
            notebook_id: The ID of the notebook to add the source to.
            url: The URL to add as a source (web page, YouTube video, etc.).
            wait: If True (default), wait for the source to finish processing
                  before returning. Set to False to return immediately.

        Returns:
            A dict with the source 'id', 'title', and 'status'.
        """
        client = await get_client()
        logger.info("Adding URL source '%s' to notebook %s", url, notebook_id)
        source = await client.sources.add_url(notebook_id, url, wait=wait)
        return _serialize_source_status(source)

    @mcp.tool()
    async def add_youtube_source(
        notebook_id: str, youtube_url: str, wait: bool = True
    ) -> dict[str, Any]:
        """Add a YouTube video as a source to a NotebookLM notebook.

        Args:
            notebook_id: The ID of the notebook.
            youtube_url: The YouTube video URL (e.g. https://www.youtube.com/watch?v=...).
            wait: If True (default), wait for the source to finish processing.

        Returns:
            A dict with the source 'id', 'title', and 'status'.
        """
        client = await get_client()
        logger.info("Adding YouTube source '%s' to notebook %s", youtube_url, notebook_id)
        source = await client.sources.add_url(notebook_id, youtube_url, wait=wait)
        return _serialize_source_status(source)

    @mcp.tool()
    async def add_text_source(
        notebook_id: str, title: str, text: str, wait: bool = True
    ) -> dict[str, Any]:
        """Add raw text content as a source to a NotebookLM notebook.

        Args:
            notebook_id: The ID of the notebook.
            title: A descriptive title for the text source.
            text: The text content to add as a source.
            wait: If True (default), wait for the source to finish processing.

        Returns:
            A dict with the source 'id', 'title', and 'status'.
        """
        client = await get_client()
        logger.info("Adding text source '%s' to notebook %s", title, notebook_id)
        source = await client.sources.add_text(notebook_id, title, text, wait=wait)
        return _serialize_source_status(source)

    @mcp.tool()
    async def delete_source(notebook_id: str, source_id: str) -> dict[str, Any]:
        """Delete a source from a NotebookLM notebook.

        Args:
            notebook_id: The ID of the notebook.
            source_id: The ID of the source to delete.

        Returns:
            A dict confirming deletion with 'success', 'notebook_id', and 'source_id'.
        """
        client = await get_client()
        await client.sources.delete(notebook_id, source_id)
        logger.info("Deleted source %s from notebook %s", source_id, notebook_id)
        return {"success": True, "notebook_id": notebook_id, "source_id": source_id}

    @mcp.tool()
    async def get_source_status(notebook_id: str, source_id: str) -> dict[str, Any]:
        """Get the current indexing status of a specific source.

        Args:
            notebook_id: The ID of the notebook.
            source_id: The ID of the source.

        Returns:
            A dict describing the source status, type, and readiness flags.
            Returns a not_found payload if the source does not exist.
        """
        client = await get_client()
        source = await client.sources.get(notebook_id, source_id)
        if source is None:
            return {
                "id": source_id,
                "status": "not_found",
                "notebook_id": notebook_id,
            }
        return _serialize_source_status(source)

    @mcp.tool()
    async def wait_for_source(
        notebook_id: str,
        source_id: str,
        timeout: int = 120,
        initial_interval: float = 1.0,
        max_interval: float = 10.0,
        backoff_factor: float = 1.5,
    ) -> dict[str, Any]:
        """Wait for a single source to finish indexing.

        Args:
            notebook_id: The ID of the notebook.
            source_id: The ID of the source to wait for.
            timeout: Maximum seconds to wait.
            initial_interval: Initial polling interval in seconds.
            max_interval: Maximum polling interval in seconds.
            backoff_factor: Interval multiplier between polls.

        Returns:
            A dict describing the final source state, or a structured error
            payload for timeout, processing failure, or missing sources.
        """
        client = await get_client()
        try:
            source = await client.sources.wait_until_ready(
                notebook_id,
                source_id,
                timeout=timeout,
                initial_interval=initial_interval,
                max_interval=max_interval,
                backoff_factor=backoff_factor,
            )
        except SourceTimeoutError as exc:
            return {
                "id": source_id,
                "status": "timeout",
                "notebook_id": notebook_id,
                "message": str(exc),
                "timeout": timeout,
            }
        except SourceProcessingError as exc:
            return {
                "id": source_id,
                "status": "error",
                "notebook_id": notebook_id,
                "message": str(exc),
            }
        except SourceNotFoundError as exc:
            return {
                "id": source_id,
                "status": "not_found",
                "notebook_id": notebook_id,
                "message": str(exc),
            }

        return _serialize_source_status(source)

    @mcp.tool()
    async def get_source_fulltext(notebook_id: str, source_id: str) -> dict[str, Any]:
        """Get the full indexed text content of a source in a NotebookLM notebook.

        Retrieves the raw text extracted and indexed from the source—what
        NotebookLM uses for chat and artifact generation. This is a capability
        not available in the NotebookLM web UI.

        Args:
            notebook_id: The ID of the notebook.
            source_id: The ID of the source.

        Returns:
            A dict with 'source_id', 'title', 'content', 'char_count', and 'url'.
        """
        client = await get_client()
        fulltext = await client.sources.get_fulltext(notebook_id, source_id)
        return {
            "source_id": fulltext.source_id,
            "title": fulltext.title,
            "content": fulltext.content,
            "char_count": fulltext.char_count,
            "url": fulltext.url,
        }

    # ──────────────────────────────────────────────
    # Chat Interaction Tools
    # ──────────────────────────────────────────────

    @mcp.tool()
    async def ask_notebook(
        notebook_id: str,
        query: str,
        source_ids: list[str] | None = None,
        conversation_id: str | None = None,
    ) -> dict[str, Any]:
        """Ask a question to a NotebookLM notebook and get an answer with citations.

        Args:
            notebook_id: The ID of the notebook to query.
            query: The question or query to send to the notebook.
            source_ids: Optional list of source IDs to restrict the query to.
                        If omitted, all sources in the notebook are used.
            conversation_id: Optional ID of an existing conversation to continue.
                             If omitted, a new conversation is started. The
                             conversation_id is returned in the response for
                             subsequent follow-up questions.

        Returns:
            A dict with:
            - 'answer': The text answer from NotebookLM.
            - 'conversation_id': The conversation ID (use for follow-up questions).
            - 'citations': A list of citation objects, each with 'source_id'
              and 'cited_text'.
        """
        client = await get_client()
        result = await client.chat.ask(
            notebook_id,
            query,
            source_ids=source_ids,
            conversation_id=conversation_id,
        )

        citations = [
            {
                "citation_number": ref.citation_number,
                "source_id": ref.source_id,
                "cited_text": ref.cited_text,
            }
            for ref in (result.references or [])
        ]

        return {
            "answer": result.answer,
            "conversation_id": result.conversation_id,
            "citations": citations,
        }

    @mcp.tool()
    async def get_chat_history(
        notebook_id: str,
        limit: int = 20,
        conversation_id: str | None = None,
    ) -> dict[str, Any]:
        """Get conversation history for a NotebookLM notebook.

        Retrieves past Q&A pairs from the most recent (or specified) conversation.

        Args:
            notebook_id: The ID of the notebook.
            limit: Maximum number of Q&A turns to retrieve (default: 20).
            conversation_id: Optional conversation ID. If omitted, the most
                             recent conversation is used.

        Returns:
            A dict with:
            - 'conversation_id': The conversation ID fetched.
            - 'turns': A list of {'question': ..., 'answer': ...} pairs.
        """
        client = await get_client()
        conv_id = conversation_id or await client.chat.get_conversation_id(notebook_id)
        if not conv_id:
            return {"conversation_id": None, "turns": []}

        history = await client.chat.get_history(notebook_id, limit=limit, conversation_id=conv_id)
        turns = [{"question": q, "answer": a} for q, a in history]
        return {"conversation_id": conv_id, "turns": turns}

    @mcp.tool()
    async def save_chat_note(
        notebook_id: str,
        title: str,
        content: str,
    ) -> dict[str, Any]:
        """Save text content as a note in a NotebookLM notebook.

        Useful for saving a chat answer or any other text as a persistent
        note inside the notebook.

        Args:
            notebook_id: The ID of the notebook.
            title: The title for the note.
            content: The text content of the note.

        Returns:
            A dict with 'success', 'note_id', and 'title'.
        """
        client = await get_client()
        note = await client.notes.create(notebook_id, title=title, content=content)
        logger.info("Saved note '%s' in notebook %s", title, notebook_id)
        return {
            "success": True,
            "note_id": note.id,
            "title": note.title,
        }

    # ──────────────────────────────────────────────
    # Research Tools
    # ──────────────────────────────────────────────

    @mcp.tool()
    async def start_research(
        notebook_id: str,
        query: str,
        source: str = "web",
        mode: str = "fast",
    ) -> dict[str, Any] | None:
        """Start a NotebookLM research task.

        Args:
            notebook_id: The ID of the notebook.
            query: The research query to run.
            source: Research source type, either 'web' or 'drive'.
            mode: Research mode, either 'fast' or 'deep'.

        Returns:
            A dict with the research task metadata, including 'task_id' and
            optional 'report_id'. Returns None if NotebookLM does not return
            a task payload.
        """
        client = await get_client()
        logger.info(
            "Starting %s %s research in notebook %s",
            mode,
            source,
            notebook_id,
        )
        return await client.research.start(
            notebook_id=notebook_id,
            query=query,
            source=source,
            mode=mode,
        )

    @mcp.tool()
    async def get_research_status(
        notebook_id: str,
        task_id: str | None = None,
    ) -> dict[str, Any]:
        """Get the latest research status for a notebook or a specific task.

        Args:
            notebook_id: The ID of the notebook.
            task_id: Optional research task ID or report ID to match.

        Returns:
            The latest research status dict when task_id is omitted. When task_id
            is provided, returns the matching task entry from the notebook's
            polled research tasks, or a not_found status payload if absent.
        """
        client = await get_client()
        result = await client.research.poll(notebook_id)

        if task_id is None:
            return result

        for task in result.get("tasks", []):
            if task.get("task_id") == task_id:
                return task

        return {
            "task_id": task_id,
            "status": "not_found",
            "notebook_id": notebook_id,
        }

    @mcp.tool()
    async def import_research_sources(
        notebook_id: str,
        task_id: str,
        sources: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Import research results into notebook sources.

        Args:
            notebook_id: The ID of the notebook.
            task_id: The research task ID or report ID to import from.
            sources: The research source entries returned by research status tools.

        Returns:
            A dict containing the task ID, requested source count, imported
            source count, and imported source metadata.
        """
        client = await get_client()
        imported_sources = await client.research.import_sources(notebook_id, task_id, sources)
        return {
            "task_id": task_id,
            "requested_count": len(sources),
            "imported_count": len(imported_sources),
            "imported_sources": imported_sources,
        }

    @mcp.tool()
    async def wait_for_research(
        notebook_id: str,
        task_id: str | None = None,
        timeout: int = 300,
        interval: int = 5,
        import_all: bool = False,
    ) -> dict[str, Any]:
        """Wait for a research task to complete and optionally import its sources.

        Args:
            notebook_id: The ID of the notebook.
            task_id: Optional research task ID or report ID to wait for.
            timeout: Maximum seconds to wait before returning a timeout payload.
            interval: Seconds between status polls.
            import_all: If True, import all sources from the completed task.

        Returns:
            A dict describing the completed task, timeout, or missing-task state.
            When import_all is True, includes imported source metadata.
        """
        client = await get_client()
        elapsed = 0

        while elapsed <= timeout:
            result = await client.research.poll(notebook_id)
            tasks = result.get("tasks", [])

            if task_id is None:
                selected_task = result if result.get("status") != "no_research" else None
            else:
                selected_task = next(
                    (task for task in tasks if task.get("task_id") == task_id),
                    None,
                )

            if selected_task is None:
                status = result.get("status")
                if status == "no_research":
                    return {
                        "task_id": task_id,
                        "status": "no_research",
                        "notebook_id": notebook_id,
                    }
                if task_id is not None:
                    return {
                        "task_id": task_id,
                        "status": "not_found",
                        "notebook_id": notebook_id,
                    }
            else:
                selected_task_id = selected_task.get("task_id")
                status = selected_task.get("status")
                if status == "completed":
                    response = {
                        "task_id": selected_task_id,
                        "status": status,
                        "query": selected_task.get("query", ""),
                        "sources": selected_task.get("sources", []),
                        "summary": selected_task.get("summary", ""),
                        "report": selected_task.get("report", ""),
                    }
                    if import_all:
                        imported_sources = await client.research.import_sources(
                            notebook_id,
                            selected_task_id,
                            selected_task.get("sources", []),
                        )
                        response["imported_count"] = len(imported_sources)
                        response["imported_sources"] = imported_sources
                    return response

            if elapsed == timeout:
                break

            await asyncio.sleep(interval)
            elapsed = min(timeout, elapsed + interval)

        return {
            "task_id": task_id,
            "status": "timeout",
            "notebook_id": notebook_id,
            "timeout": timeout,
        }
