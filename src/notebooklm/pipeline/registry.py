"""Plugin registry for pipeline extensibility.

Manages registration and discovery of:
- Source plugins (YouTube, URL, research, etc.)
- Tool plugins (NotebookLM, Perplexity, etc.)
- Exporter plugins (markdown, JSON, audio, etc.)
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

if TYPE_CHECKING:
    from ..client import NotebookLMClient
    from .context import PipelineContext


class PluginType(str, Enum):
    """Types of plugins."""

    SOURCE = "source"
    TOOL = "tool"
    EXPORTER = "exporter"


@runtime_checkable
class Plugin(Protocol):
    """Protocol for all plugins.

    Plugins extend pipeline capabilities:
    - Source plugins add new ways to ingest content
    - Tool plugins wrap external services
    - Exporter plugins handle output formats
    """

    name: str
    plugin_type: PluginType

    def get_config_schema(self) -> dict[str, Any]:
        """Return JSON schema for plugin configuration."""
        ...


@runtime_checkable
class SourcePlugin(Protocol):
    """Protocol for source plugins.

    Source plugins add content to notebooks from various sources.
    """

    name: str
    plugin_type: PluginType

    async def add_sources(
        self,
        ctx: "PipelineContext",
        client: "NotebookLMClient",
        config: dict[str, Any],
    ) -> list[str]:
        """Add sources and return list of source IDs."""
        ...

    def get_config_schema(self) -> dict[str, Any]:
        """Return JSON schema for plugin configuration."""
        ...


@runtime_checkable
class ToolPlugin(Protocol):
    """Protocol for tool plugins.

    Tool plugins wrap external services for content generation.
    """

    name: str
    plugin_type: PluginType

    async def execute(
        self,
        ctx: "PipelineContext",
        client: "NotebookLMClient",
        config: dict[str, Any],
    ) -> dict[str, Any]:
        """Execute the tool and return results."""
        ...

    def get_config_schema(self) -> dict[str, Any]:
        """Return JSON schema for plugin configuration."""
        ...


@runtime_checkable
class ExporterPlugin(Protocol):
    """Protocol for exporter plugins.

    Exporter plugins handle output formats and file writing.
    """

    name: str
    plugin_type: PluginType

    async def export(
        self,
        ctx: "PipelineContext",
        client: "NotebookLMClient",
        config: dict[str, Any],
    ) -> list[str]:
        """Export content and return list of output paths."""
        ...

    def get_config_schema(self) -> dict[str, Any]:
        """Return JSON schema for plugin configuration."""
        ...


class BasePlugin:
    """Base class for plugin implementations."""

    name: str = "base"
    plugin_type: PluginType = PluginType.SOURCE

    def get_config_schema(self) -> dict[str, Any]:
        """Return JSON schema for plugin configuration."""
        return {"type": "object", "properties": {}}


class BaseSourcePlugin(BasePlugin, ABC):
    """Base class for source plugins."""

    plugin_type = PluginType.SOURCE

    @abstractmethod
    async def add_sources(
        self,
        ctx: "PipelineContext",
        client: "NotebookLMClient",
        config: dict[str, Any],
    ) -> list[str]:
        """Add sources and return list of source IDs."""
        pass


class BaseToolPlugin(BasePlugin, ABC):
    """Base class for tool plugins."""

    plugin_type = PluginType.TOOL

    @abstractmethod
    async def execute(
        self,
        ctx: "PipelineContext",
        client: "NotebookLMClient",
        config: dict[str, Any],
    ) -> dict[str, Any]:
        """Execute the tool and return results."""
        pass


class BaseExporterPlugin(BasePlugin, ABC):
    """Base class for exporter plugins."""

    plugin_type = PluginType.EXPORTER

    @abstractmethod
    async def export(
        self,
        ctx: "PipelineContext",
        client: "NotebookLMClient",
        config: dict[str, Any],
    ) -> list[str]:
        """Export content and return list of output paths."""
        pass


@dataclass
class PluginRegistry:
    """Registry for pipeline plugins.

    Manages plugin registration and lookup by type and name.
    Plugins are registered with namespaced names like:
    - source:youtube
    - tool:notebooklm
    - exporter:markdown

    Example:
        registry = PluginRegistry()
        registry.register(YouTubeSourcePlugin())
        plugin = registry.get("source:youtube")
    """

    _sources: dict[str, BaseSourcePlugin] = field(default_factory=dict)
    _tools: dict[str, BaseToolPlugin] = field(default_factory=dict)
    _exporters: dict[str, BaseExporterPlugin] = field(default_factory=dict)

    def register(self, plugin: BasePlugin) -> None:
        """Register a plugin.

        Args:
            plugin: Plugin instance to register
        """
        if plugin.plugin_type == PluginType.SOURCE:
            self._sources[plugin.name] = plugin  # type: ignore
        elif plugin.plugin_type == PluginType.TOOL:
            self._tools[plugin.name] = plugin  # type: ignore
        elif plugin.plugin_type == PluginType.EXPORTER:
            self._exporters[plugin.name] = plugin  # type: ignore

    def get(self, full_name: str) -> BasePlugin | None:
        """Get a plugin by full name (e.g., "source:youtube").

        Args:
            full_name: Full plugin name with type prefix

        Returns:
            Plugin instance or None if not found
        """
        if ":" not in full_name:
            return None

        plugin_type, name = full_name.split(":", 1)

        if plugin_type == "source":
            return self._sources.get(name)
        elif plugin_type == "tool":
            return self._tools.get(name)
        elif plugin_type == "exporter":
            return self._exporters.get(name)

        return None

    def get_source(self, name: str) -> BaseSourcePlugin | None:
        """Get a source plugin by name."""
        return self._sources.get(name)

    def get_tool(self, name: str) -> BaseToolPlugin | None:
        """Get a tool plugin by name."""
        return self._tools.get(name)

    def get_exporter(self, name: str) -> BaseExporterPlugin | None:
        """Get an exporter plugin by name."""
        return self._exporters.get(name)

    def list_plugins(self, plugin_type: PluginType | None = None) -> list[str]:
        """List all registered plugin names.

        Args:
            plugin_type: Optional filter by plugin type

        Returns:
            List of full plugin names (e.g., "source:youtube")
        """
        plugins: list[str] = []

        if plugin_type is None or plugin_type == PluginType.SOURCE:
            plugins.extend(f"source:{name}" for name in self._sources)

        if plugin_type is None or plugin_type == PluginType.TOOL:
            plugins.extend(f"tool:{name}" for name in self._tools)

        if plugin_type is None or plugin_type == PluginType.EXPORTER:
            plugins.extend(f"exporter:{name}" for name in self._exporters)

        return sorted(plugins)


def create_default_registry() -> PluginRegistry:
    """Create a registry with default built-in plugins.

    Returns:
        PluginRegistry with standard plugins registered
    """
    from .plugins.exporters.audio import AudioExporterPlugin
    from .plugins.exporters.json_export import JsonExporterPlugin
    from .plugins.exporters.markdown import MarkdownExporterPlugin
    from .plugins.sources.research import ResearchSourcePlugin
    from .plugins.sources.web_url import WebUrlSourcePlugin
    from .plugins.sources.youtube import YouTubeSourcePlugin
    from .plugins.tools.notebooklm import NotebookLMToolPlugin

    registry = PluginRegistry()

    # Register source plugins
    registry.register(YouTubeSourcePlugin())
    registry.register(WebUrlSourcePlugin())
    registry.register(ResearchSourcePlugin())

    # Register tool plugins
    registry.register(NotebookLMToolPlugin())

    # Register exporter plugins
    registry.register(MarkdownExporterPlugin())
    registry.register(JsonExporterPlugin())
    registry.register(AudioExporterPlugin())

    return registry
