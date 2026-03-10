"""Markdown exporter plugin.

Exports reports and Q&A results to markdown files.
"""

from pathlib import Path
from typing import TYPE_CHECKING, Any

from ...registry import BaseExporterPlugin, PluginType

if TYPE_CHECKING:
    from ....client import NotebookLMClient
    from ...context import PipelineContext


class MarkdownExporterPlugin(BaseExporterPlugin):
    """Plugin for exporting content to markdown files.

    Exports:
    - Report artifacts as markdown
    - Q&A results as markdown
    - Pipeline summary as markdown

    Config:
        output: Output file path (supports variable substitution)
        include_qa: Whether to include Q&A results (default: true)
        include_summary: Whether to include pipeline summary (default: false)

    Example:
        plugin: exporter:markdown
        output: "./output/{{ topic | slugify }}-guide.md"
        include_qa: true
    """

    name = "markdown"
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
                "include_qa": {
                    "type": "boolean",
                    "description": "Include Q&A results",
                    "default": True,
                },
                "include_summary": {
                    "type": "boolean",
                    "description": "Include pipeline summary",
                    "default": False,
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
        """Export content to markdown file.

        Args:
            ctx: Pipeline context
            client: NotebookLM client
            config: Plugin configuration

        Returns:
            List of exported file paths
        """
        from ....types import ArtifactType

        output_path = config.get("output", "output.md")
        include_qa = config.get("include_qa", True)
        include_summary = config.get("include_summary", False)

        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)

        content_parts = []

        # Add title
        title = ctx.notebook_title or ctx.pipeline_name or "Pipeline Output"
        content_parts.append(f"# {title}\n")

        # Add pipeline info if summary requested
        if include_summary:
            content_parts.append("## Pipeline Summary\n")
            content_parts.append(f"- **Pipeline**: {ctx.pipeline_name}")
            content_parts.append(f"- **Notebook ID**: {ctx.notebook_id}")
            if ctx.notebook_url:
                content_parts.append(f"- **Notebook URL**: {ctx.notebook_url}")
            content_parts.append(f"- **Sources**: {len(ctx.source_ids)}")
            content_parts.append(f"- **Artifacts**: {len(ctx.artifact_ids)}")
            content_parts.append("")

        # Export report artifacts
        if ctx.notebook_id:
            try:
                import tempfile

                artifacts = await client.artifacts.list(ctx.notebook_id)
                report_artifacts = [
                    a for a in artifacts if a.kind == ArtifactType.REPORT and a.is_completed
                ]

                for artifact in report_artifacts:
                    try:
                        # download_report writes to a file
                        with tempfile.NamedTemporaryFile(
                            mode="w", suffix=".md", delete=False
                        ) as tmp:
                            tmp_path = tmp.name
                        await client.artifacts.download_report(
                            ctx.notebook_id, tmp_path, artifact_id=artifact.id
                        )
                        report_content = Path(tmp_path).read_text(encoding="utf-8")
                        Path(tmp_path).unlink()  # Clean up temp file
                        content_parts.append(f"## {artifact.title}\n")
                        content_parts.append(report_content)
                        content_parts.append("")
                    except Exception:
                        pass  # Skip artifacts that can't be read
            except Exception:
                pass  # Skip if artifacts can't be listed

        # Add Q&A results
        if include_qa and ctx.qa_results:
            content_parts.append("## Questions & Answers\n")
            for qa in ctx.qa_results:
                content_parts.append(f"### Q: {qa['question']}\n")
                content_parts.append(qa["answer"])
                content_parts.append("")

        # Write file
        content = "\n".join(content_parts)
        path.write_text(content, encoding="utf-8")

        return [str(path)]
