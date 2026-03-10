"""Audio exporter plugin.

Downloads audio artifacts to files.
"""

from pathlib import Path
from typing import TYPE_CHECKING, Any

from ...registry import BaseExporterPlugin, PluginType

if TYPE_CHECKING:
    from ....client import NotebookLMClient
    from ...context import PipelineContext


class AudioExporterPlugin(BaseExporterPlugin):
    """Plugin for downloading audio artifacts.

    Downloads completed audio artifacts (podcasts) to files.

    Config:
        output: Output file path (supports variable substitution)
        artifact_id: Specific artifact ID to download (optional, downloads all audio if not specified)

    Example:
        plugin: exporter:audio
        output: "./output/{{ topic | slugify }}.mp3"
    """

    name = "audio"
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
                "artifact_id": {
                    "type": "string",
                    "description": "Specific artifact ID to download",
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
        """Download audio artifacts to files.

        Args:
            ctx: Pipeline context
            client: NotebookLM client
            config: Plugin configuration

        Returns:
            List of exported file paths
        """
        from ....types import ArtifactType

        if not ctx.notebook_id:
            raise ValueError("No notebook ID in context")

        output_path = config.get("output", "output.mp3")
        artifact_id = config.get("artifact_id")

        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)

        exported_paths = []

        if artifact_id:
            # Download specific artifact
            await client.artifacts.download_audio(ctx.notebook_id, artifact_id, str(path))
            ctx.artifact_outputs[artifact_id] = str(path)
            exported_paths.append(str(path))
        else:
            # Download all completed audio artifacts
            artifacts = await client.artifacts.list(ctx.notebook_id)
            audio_artifacts = [
                a for a in artifacts if a.kind == ArtifactType.AUDIO and a.is_completed
            ]

            for i, artifact in enumerate(audio_artifacts):
                if len(audio_artifacts) > 1:
                    # Add index to filename for multiple artifacts
                    stem = path.stem
                    suffix = path.suffix
                    artifact_path = path.parent / f"{stem}_{i + 1}{suffix}"
                else:
                    artifact_path = path

                await client.artifacts.download_audio(
                    ctx.notebook_id, artifact.id, str(artifact_path)
                )
                ctx.artifact_outputs[artifact.id] = str(artifact_path)
                exported_paths.append(str(artifact_path))

        return exported_paths
