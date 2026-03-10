"""Research source plugin.

Uses NotebookLM's research feature to discover and add sources.
"""

from typing import TYPE_CHECKING, Any

from ...registry import BaseSourcePlugin, PluginType

if TYPE_CHECKING:
    from ....client import NotebookLMClient
    from ...context import PipelineContext


class ResearchSourcePlugin(BaseSourcePlugin):
    """Plugin for using NotebookLM's research feature.

    The research feature searches the web for relevant sources
    based on a query and allows importing them into a notebook.

    Config:
        query: Search query for research
        max_sources: Maximum number of sources to import (default: all)
        auto_import: Whether to auto-import found sources (default: true)

    Example:
        - plugin: source:research
          query: "latest developments in quantum computing 2024"
          max_sources: 10
    """

    name = "research"
    plugin_type = PluginType.SOURCE

    def get_config_schema(self) -> dict[str, Any]:
        """Return JSON schema for plugin configuration."""
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Research query",
                },
                "max_sources": {
                    "type": "integer",
                    "description": "Maximum sources to import",
                    "minimum": 1,
                },
                "auto_import": {
                    "type": "boolean",
                    "description": "Auto-import found sources",
                    "default": True,
                },
            },
            "required": ["query"],
        }

    async def add_sources(
        self,
        ctx: "PipelineContext",
        client: "NotebookLMClient",
        config: dict[str, Any],
    ) -> list[str]:
        """Research and add sources.

        Args:
            ctx: Pipeline context with notebook_id
            client: NotebookLM client
            config: Plugin configuration

        Returns:
            List of added source IDs
        """
        if not ctx.notebook_id:
            raise ValueError("No notebook ID in context")

        query = config.get("query", "")
        if not query:
            raise ValueError("Research query is required")

        max_sources = config.get("max_sources")
        auto_import = config.get("auto_import", True)

        # Start research - requires notebook_id
        research_result = await client.research.start(ctx.notebook_id, query)
        if not research_result:
            return []

        # Poll for results
        poll_result = await client.research.poll(ctx.notebook_id)
        sources = poll_result.get("sources", [])
        if not sources:
            return []

        # Limit sources if specified
        if max_sources and len(sources) > max_sources:
            sources = sources[:max_sources]

        # Import sources if auto_import is enabled
        if auto_import:
            task_id = research_result.get("task_id", "")
            # import_sources returns list of dicts with 'id' and 'title'
            imported = await client.research.import_sources(ctx.notebook_id, task_id, sources)
            # Extract just the IDs
            return [s.get("id", "") for s in imported if s.get("id")]

        return []
