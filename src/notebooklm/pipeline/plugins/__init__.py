"""Pipeline plugins package.

Contains built-in plugins for sources, tools, and exporters.
"""

from .exporters.audio import AudioExporterPlugin
from .exporters.json_export import JsonExporterPlugin
from .exporters.markdown import MarkdownExporterPlugin
from .sources.research import ResearchSourcePlugin
from .sources.web_url import WebUrlSourcePlugin
from .sources.youtube import YouTubeSourcePlugin
from .tools.notebooklm import NotebookLMToolPlugin

__all__ = [
    # Sources
    "YouTubeSourcePlugin",
    "WebUrlSourcePlugin",
    "ResearchSourcePlugin",
    # Tools
    "NotebookLMToolPlugin",
    # Exporters
    "MarkdownExporterPlugin",
    "JsonExporterPlugin",
    "AudioExporterPlugin",
]
