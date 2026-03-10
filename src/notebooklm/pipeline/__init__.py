"""NotebookLM Pipeline Framework.

A modular framework for building research pipelines with NotebookLM.

Key Components:
- PipelineEngine: Orchestrates pipeline execution
- PipelineContext: Shared state across steps
- PipelineConfig: YAML-based configuration
- Steps: Built-in and custom pipeline steps
- Plugins: Source, tool, and exporter plugins

Example:
    from notebooklm import NotebookLMClient
    from notebooklm.pipeline import PipelineEngine

    async with await NotebookLMClient.from_storage() as client:
        engine = PipelineEngine()
        result = await engine.run(
            "research-to-podcast.yaml",
            client=client,
            variables={"topic": "quantum computing"}
        )
        print(f"Notebook: {result.notebook_url}")
        print(f"Audio: {result.artifact_outputs}")
"""

from .config import (
    PipelineConfig,
    PipelineConfigError,
    PipelineValidationError,
    StepConfig,
    load_pipeline_config,
    slugify,
    substitute_variables,
    validate_pipeline_file,
)
from .context import (
    PipelineContext,
    PipelineStatus,
    StepResult,
)
from .engine import (
    PipelineEngine,
    PipelineError,
    ProgressCallback,
    StepError,
)
from .registry import (
    BaseExporterPlugin,
    BasePlugin,
    BaseSourcePlugin,
    BaseToolPlugin,
    ExporterPlugin,
    Plugin,
    PluginRegistry,
    PluginType,
    SourcePlugin,
    ToolPlugin,
    create_default_registry,
)
from .steps import (
    BUILTIN_STEPS,
    AskStep,
    BaseStep,
    CreateNotebookStep,
    ExportStep,
    IngestStep,
    PipelineStep,
    SynthesizeStep,
    WaitArtifactsStep,
    WaitSourcesStep,
    get_builtin_step,
)

__all__ = [
    # Engine
    "PipelineEngine",
    "PipelineError",
    "StepError",
    "ProgressCallback",
    # Context
    "PipelineContext",
    "PipelineStatus",
    "StepResult",
    # Config
    "PipelineConfig",
    "StepConfig",
    "PipelineConfigError",
    "PipelineValidationError",
    "load_pipeline_config",
    "validate_pipeline_file",
    "substitute_variables",
    "slugify",
    # Steps
    "PipelineStep",
    "BaseStep",
    "BUILTIN_STEPS",
    "get_builtin_step",
    "CreateNotebookStep",
    "IngestStep",
    "WaitSourcesStep",
    "SynthesizeStep",
    "WaitArtifactsStep",
    "AskStep",
    "ExportStep",
    # Registry
    "PluginRegistry",
    "PluginType",
    "create_default_registry",
    # Plugin Protocols
    "Plugin",
    "SourcePlugin",
    "ToolPlugin",
    "ExporterPlugin",
    # Plugin Base Classes
    "BasePlugin",
    "BaseSourcePlugin",
    "BaseToolPlugin",
    "BaseExporterPlugin",
]
