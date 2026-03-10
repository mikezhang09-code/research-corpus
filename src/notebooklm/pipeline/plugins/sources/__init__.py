"""Source plugins for pipeline ingestion."""

from .research import ResearchSourcePlugin
from .web_url import WebUrlSourcePlugin
from .youtube import YouTubeSourcePlugin

__all__ = [
    "YouTubeSourcePlugin",
    "WebUrlSourcePlugin",
    "ResearchSourcePlugin",
]
