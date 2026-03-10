"""YouTube source plugin.

Adds YouTube videos as sources to a notebook.
"""

from typing import TYPE_CHECKING, Any

from ...registry import BaseSourcePlugin, PluginType

if TYPE_CHECKING:
    from ....client import NotebookLMClient
    from ...context import PipelineContext


class YouTubeSourcePlugin(BaseSourcePlugin):
    """Plugin for adding YouTube videos as sources.

    Config:
        url: Single YouTube video URL
        urls: List of YouTube video URLs
        playlist: YouTube playlist URL (adds all videos)

    Example:
        - plugin: source:youtube
          url: "https://www.youtube.com/watch?v=abc123"

        - plugin: source:youtube
          urls:
            - "https://www.youtube.com/watch?v=abc123"
            - "https://www.youtube.com/watch?v=def456"
    """

    name = "youtube"
    plugin_type = PluginType.SOURCE

    def get_config_schema(self) -> dict[str, Any]:
        """Return JSON schema for plugin configuration."""
        return {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "Single YouTube video URL",
                },
                "urls": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of YouTube video URLs",
                },
                "playlist": {
                    "type": "string",
                    "description": "YouTube playlist URL",
                },
            },
        }

    async def add_sources(
        self,
        ctx: "PipelineContext",
        client: "NotebookLMClient",
        config: dict[str, Any],
    ) -> list[str]:
        """Add YouTube videos as sources.

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
        for video_url in urls:
            source = await client.sources.add_url(ctx.notebook_id, video_url)
            source_ids.append(source.id)

        # Handle playlist
        playlist_url = config.get("playlist")
        if playlist_url:
            # Note: NotebookLM handles playlist URLs directly
            # It will expand the playlist into individual video sources
            source = await client.sources.add_url(ctx.notebook_id, playlist_url)
            source_ids.append(source.id)

        return source_ids
