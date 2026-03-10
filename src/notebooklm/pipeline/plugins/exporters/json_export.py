"""JSON exporter plugin.

Exports pipeline results to JSON files.
"""

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ...registry import BaseExporterPlugin, PluginType

if TYPE_CHECKING:
    from ....client import NotebookLMClient
    from ...context import PipelineContext


class JsonExporterPlugin(BaseExporterPlugin):
    """Plugin for exporting pipeline results to JSON.

    Exports the complete pipeline context including:
    - Pipeline metadata
    - Notebook information
    - Source and artifact IDs
    - Q&A results
    - Step results and errors

    Config:
        output: Output file path (supports variable substitution)
        indent: JSON indentation (default: 2)
        include_results: Whether to include step results (default: true)

    Example:
        plugin: exporter:json
        output: "./output/{{ topic | slugify }}-results.json"
        indent: 2
    """

    name = "json"
    plugin_type = PluginType.EXPORTER

    def get_config_schema(self) -> dict[str, Any]:
        """Return JSON schema for plugin configuration."""
        return {
            "type": "object",
            "properties": {
                "output": {
                    "type": "string",
                    "description": "Output file path",
                },
                "indent": {
                    "type": "integer",
                    "description": "JSON indentation",
                    "default": 2,
                },
                "include_results": {
                    "type": "boolean",
                    "description": "Include step results",
                    "default": True,
                },
            },
            "required": ["output"],
        }

    async def export(
        self,
        ctx: "PipelineContext",
        client: "NotebookLMClient",
        config: dict[str, Any],
    ) -> list[str]:
        """Export pipeline results to JSON file.

        Args:
            ctx: Pipeline context
            client: NotebookLM client (unused but required by protocol)
            config: Plugin configuration

        Returns:
            List of exported file paths
        """
        output_path = config.get("output", "output.json")
        indent = config.get("indent", 2)
        include_results = config.get("include_results", True)

        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)

        # Build export data
        data = ctx.to_dict()

        # Optionally remove detailed results
        if not include_results:
            data.pop("results", None)

        # Write JSON file
        path.write_text(
            json.dumps(data, indent=indent, default=str, ensure_ascii=False),
            encoding="utf-8",
        )

        return [str(path)]
