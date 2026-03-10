"""Web URL source plugin.

Adds web pages as sources to a notebook.
"""

from typing import TYPE_CHECKING, Any

from ...registry import BaseSourcePlugin, PluginType

if TYPE_CHECKING:
    from ....client import NotebookLMClient
    from ...context import PipelineContext


class WebUrlSourcePlugin(BaseSourcePlugin):
    """Plugin for adding web pages as sources.

    Config:
        url: Single web page URL
        urls: List of web page URLs

    Example:
        - plugin: source:web_url
          url: "https://example.com/article"

        - plugin: source:web_url
          urls:
            - "https://example.com/page1"
            - "https://example.com/page2"
    """

    name = "web_url"
    plugin_type = PluginType.SOURCE

    def get_config_schema(self) -> dict[str, Any]:
        """Return JSON schema for plugin configuration."""
        return {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "Single web page URL",
                },
                "urls": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of web page URLs",
                },
            },
        }

    async def add_sources(
        self,
        ctx: "PipelineContext",
        client: "NotebookLMClient",
        config: dict[str, Any],
    ) -> list[str]:
        """Add web pages as sources.

        Args:
            ctx: Pipeline context with notebook_id
            client: NotebookLM client
            config: Plugin configuration

        Returns:
            List of added source IDs
        """
        if not ctx.notebook_id:
            raise ValueError("No notebook ID in context")

        source_ids: list[str] = []

        # Handle single URL
        url = config.get("url")
        if url:
            source = await client.sources.add_url(ctx.notebook_id, url)
            source_ids.append(source.id)

        # Handle multiple URLs
        urls = config.get("urls", [])
        for web_url in urls:
            source = await client.sources.add_url(ctx.notebook_id, web_url)
            source_ids.append(source.id)

        return source_ids
