"""Pipeline engine - orchestrates pipeline execution.

The PipelineEngine is the main entry point for running pipelines:
- Loads and validates configuration
- Manages execution context
- Runs steps in sequence
- Handles errors and progress reporting
"""

import logging
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .config import PipelineConfig, StepConfig, load_pipeline_config
from .context import PipelineContext, PipelineStatus, StepResult
from .registry import PluginRegistry, PluginType, create_default_registry
from .steps import BUILTIN_STEPS, get_builtin_step

if TYPE_CHECKING:
    from ..client import NotebookLMClient

logger = logging.getLogger(__name__)


class PipelineError(Exception):
    """Error during pipeline execution."""

    pass


class StepError(PipelineError):
    """Error during step execution."""

    def __init__(self, step_name: str, message: str, cause: Exception | None = None):
        self.step_name = step_name
        self.cause = cause
        super().__init__(f"Step '{step_name}' failed: {message}")


# Type for progress callback
ProgressCallback = Callable[[str, str, int, int], None]


class PipelineEngine:
    """Engine for executing research pipelines.

    The engine handles:
    - Loading pipeline configuration from YAML
    - Managing pipeline context (shared state)
    - Executing steps in sequence
    - Plugin resolution and execution
    - Error handling and progress reporting

    Example:
        engine = PipelineEngine()
        async with await NotebookLMClient.from_storage() as client:
            result = await engine.run(
                "research-to-podcast.yaml",
                client=client,
                variables={"topic": "quantum computing"}
            )
            print(f"Pipeline completed: {result.notebook_url}")
    """

    def __init__(
        self,
        registry: PluginRegistry | None = None,
        progress_callback: ProgressCallback | None = None,
    ):
        """Initialize the pipeline engine.

        Args:
            registry: Plugin registry (uses default if not provided)
            progress_callback: Optional callback for progress updates
                Signature: (step_name, status, current_step, total_steps) -> None
        """
        self.registry = registry or create_default_registry()
        self.progress_callback = progress_callback

    def _report_progress(self, step_name: str, status: str, current: int, total: int) -> None:
        """Report progress to callback if set."""
        if self.progress_callback:
            self.progress_callback(step_name, status, current, total)
        logger.info("Pipeline progress: [%d/%d] %s - %s", current, total, step_name, status)

    async def run(
        self,
        config_path: Path | str,
        client: "NotebookLMClient",
        variables: dict[str, Any] | None = None,
    ) -> PipelineContext:
        """Run a pipeline from configuration file.

        Args:
            config_path: Path to pipeline YAML configuration
            client: NotebookLM client for API calls
            variables: Runtime variables for template substitution

        Returns:
            PipelineContext with results

        Raises:
            PipelineError: If pipeline fails
        """
        # Load and validate configuration
        config = load_pipeline_config(config_path, variables)

        # Create context
        ctx = PipelineContext(
            pipeline_name=config.name,
            variables=config.variables,
        )

        return await self.run_config(config, client, ctx)

    async def run_config(
        self,
        config: PipelineConfig,
        client: "NotebookLMClient",
        ctx: PipelineContext | None = None,
    ) -> PipelineContext:
        """Run a pipeline from configuration object.

        Args:
            config: Pipeline configuration
            client: NotebookLM client for API calls
            ctx: Optional existing context (creates new if not provided)

        Returns:
            PipelineContext with results
        """
        if ctx is None:
            ctx = PipelineContext(
                pipeline_name=config.name,
                variables=config.variables,
            )

        ctx.status = PipelineStatus.RUNNING
        ctx.started_at = datetime.now()

        total_steps = len(config.steps)
        logger.info("Starting pipeline '%s' with %d steps", config.name, total_steps)

        try:
            for i, step_config in enumerate(config.steps, 1):
                ctx.current_step = step_config.name
                self._report_progress(step_config.name, "starting", i, total_steps)

                # Check conditional execution
                if step_config.when and not self._evaluate_condition(step_config.when, ctx):
                    logger.info("Skipping step '%s' (condition not met)", step_config.name)
                    self._report_progress(step_config.name, "skipped", i, total_steps)
                    continue

                # Execute the step
                result = await self.run_step(step_config, client, ctx)

                # Record result
                ctx.add_result(step_config.name, result)

                if result.success:
                    self._report_progress(step_config.name, "completed", i, total_steps)
                else:
                    self._report_progress(step_config.name, "failed", i, total_steps)
                    # Log error but continue if it's a soft failure
                    logger.warning("Step '%s' failed: %s", step_config.name, result.error)

            ctx.status = PipelineStatus.COMPLETED
            logger.info("Pipeline '%s' completed successfully", config.name)

        except Exception as e:
            ctx.status = PipelineStatus.FAILED
            ctx.add_error(ctx.current_step or "unknown", str(e), e)
            logger.error("Pipeline '%s' failed: %s", config.name, e)
            raise PipelineError(f"Pipeline failed: {e}") from e

        finally:
            ctx.completed_at = datetime.now()
            ctx.current_step = None

        return ctx

    async def run_step(
        self,
        step_config: StepConfig,
        client: "NotebookLMClient",
        ctx: PipelineContext,
    ) -> StepResult:
        """Run a single pipeline step.

        Args:
            step_config: Step configuration
            client: NotebookLM client
            ctx: Pipeline context

        Returns:
            StepResult with outcome
        """
        step_type = step_config.step_type
        step_handler = step_config.step_handler

        logger.debug(
            "Running step '%s' (type=%s, handler=%s)",
            step_config.name,
            step_type,
            step_handler,
        )

        try:
            if step_type == "builtin":
                return await self._run_builtin_step(step_handler, client, ctx, step_config.config)

            elif step_type == "source":
                return await self._run_source_plugin(step_handler, client, ctx, step_config.config)

            elif step_type == "tool":
                return await self._run_tool_plugin(step_handler, client, ctx, step_config.config)

            elif step_type == "exporter":
                return await self._run_exporter_plugin(
                    step_handler, client, ctx, step_config.config
                )

            else:
                raise StepError(step_config.name, f"Unknown step type: {step_type}")

        except Exception as e:
            logger.error("Step '%s' raised exception: %s", step_config.name, e)
            return StepResult(
                step_name=step_config.name,
                success=False,
                error=str(e),
                started_at=datetime.now(),
                completed_at=datetime.now(),
            )

    async def _run_builtin_step(
        self,
        handler: str,
        client: "NotebookLMClient",
        ctx: PipelineContext,
        config: dict[str, Any],
    ) -> StepResult:
        """Run a built-in step."""
        step = get_builtin_step(handler)
        if not step:
            raise StepError(handler, f"Unknown built-in step: {handler}")

        return await step.execute(ctx, client, config)

    async def _run_source_plugin(
        self,
        handler: str,
        client: "NotebookLMClient",
        ctx: PipelineContext,
        config: dict[str, Any],
    ) -> StepResult:
        """Run a source plugin."""
        plugin = self.registry.get_source(handler)
        if not plugin:
            raise StepError(handler, f"Unknown source plugin: {handler}")

        started = datetime.now()
        try:
            source_ids = await plugin.add_sources(ctx, client, config)
            ctx.source_ids.extend(source_ids)
            return StepResult(
                step_name=handler,
                success=True,
                output={"source_ids": source_ids},
                started_at=started,
                completed_at=datetime.now(),
            )
        except Exception as e:
            return StepResult(
                step_name=handler,
                success=False,
                error=str(e),
                started_at=started,
                completed_at=datetime.now(),
            )

    async def _run_tool_plugin(
        self,
        handler: str,
        client: "NotebookLMClient",
        ctx: PipelineContext,
        config: dict[str, Any],
    ) -> StepResult:
        """Run a tool plugin."""
        plugin = self.registry.get_tool(handler)
        if not plugin:
            raise StepError(handler, f"Unknown tool plugin: {handler}")

        started = datetime.now()
        try:
            result = await plugin.execute(ctx, client, config)
            return StepResult(
                step_name=handler,
                success=True,
                output=result,
                started_at=started,
                completed_at=datetime.now(),
            )
        except Exception as e:
            return StepResult(
                step_name=handler,
                success=False,
                error=str(e),
                started_at=started,
                completed_at=datetime.now(),
            )

    async def _run_exporter_plugin(
        self,
        handler: str,
        client: "NotebookLMClient",
        ctx: PipelineContext,
        config: dict[str, Any],
    ) -> StepResult:
        """Run an exporter plugin."""
        plugin = self.registry.get_exporter(handler)
        if not plugin:
            raise StepError(handler, f"Unknown exporter plugin: {handler}")

        started = datetime.now()
        try:
            paths = await plugin.export(ctx, client, config)
            return StepResult(
                step_name=handler,
                success=True,
                output={"paths": paths},
                started_at=started,
                completed_at=datetime.now(),
            )
        except Exception as e:
            return StepResult(
                step_name=handler,
                success=False,
                error=str(e),
                started_at=started,
                completed_at=datetime.now(),
            )

    def _evaluate_condition(self, condition: str, ctx: PipelineContext) -> bool:
        """Evaluate a step condition.

        Simple evaluation of conditions like:
        - "notebook_id"  -> ctx.notebook_id is not None
        - "source_ids"   -> len(ctx.source_ids) > 0
        - "variable:foo" -> ctx.get_variable("foo") is truthy

        Args:
            condition: Condition string
            ctx: Pipeline context

        Returns:
            True if condition is met
        """
        if condition.startswith("variable:"):
            var_name = condition.split(":", 1)[1]
            return bool(ctx.get_variable(var_name))

        if condition == "notebook_id":
            return ctx.notebook_id is not None

        if condition == "source_ids":
            return len(ctx.source_ids) > 0

        if condition == "artifact_ids":
            return len(ctx.artifact_ids) > 0

        # Default: evaluate as boolean
        return bool(condition)

    def list_available_steps(self) -> dict[str, list[str]]:
        """List all available step types.

        Returns:
            Dictionary with builtin, source, tool, and exporter step names
        """
        return {
            "builtin": list(BUILTIN_STEPS.keys()),
            "source": [
                name.split(":", 1)[1] for name in self.registry.list_plugins(PluginType.SOURCE)
            ],
            "tool": [name.split(":", 1)[1] for name in self.registry.list_plugins(PluginType.TOOL)],
            "exporter": [
                name.split(":", 1)[1] for name in self.registry.list_plugins(PluginType.EXPORTER)
            ],
        }
