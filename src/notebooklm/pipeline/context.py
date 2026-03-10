"""Pipeline context - shared state across pipeline steps.

The PipelineContext holds all state that needs to be passed between steps,
including notebook IDs, source IDs, artifact IDs, and step results.
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any
from uuid import uuid4


class PipelineStatus(str, Enum):
    """Pipeline execution status."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class StepResult:
    """Result of a single step execution."""

    step_name: str
    success: bool
    output: Any = None
    error: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None

    @property
    def duration_seconds(self) -> float | None:
        """Get step duration in seconds."""
        if self.started_at and self.completed_at:
            return (self.completed_at - self.started_at).total_seconds()
        return None


@dataclass
class PipelineContext:
    """Shared context passed between pipeline steps.

    This dataclass holds all state that accumulates during pipeline execution:
    - Identifiers (pipeline, notebook, sources, artifacts)
    - Results from each step
    - Errors encountered
    - Variables for template substitution

    Example:
        ctx = PipelineContext(
            pipeline_name="research-to-podcast",
            variables={"topic": "quantum computing"}
        )
        # After create_notebook step:
        ctx.notebook_id = "abc123"
        # After ingest step:
        ctx.source_ids.extend(["src1", "src2"])
        # After synthesize step:
        ctx.artifact_ids.extend(["art1"])
    """

    # Pipeline identity
    pipeline_id: str = field(default_factory=lambda: str(uuid4()))
    pipeline_name: str = ""

    # NotebookLM state
    notebook_id: str | None = None
    notebook_title: str | None = None
    notebook_url: str | None = None
    source_ids: list[str] = field(default_factory=list)
    artifact_ids: list[str] = field(default_factory=list)

    # Step results (step_name -> StepResult)
    results: dict[str, StepResult] = field(default_factory=dict)

    # Errors encountered during execution
    errors: list[dict[str, Any]] = field(default_factory=list)

    # Variables for template substitution
    variables: dict[str, Any] = field(default_factory=dict)

    # Execution state
    status: PipelineStatus = PipelineStatus.PENDING
    started_at: datetime | None = None
    completed_at: datetime | None = None
    current_step: str | None = None

    # Artifact outputs (for exporters)
    # Maps artifact_id -> downloaded content/path
    artifact_outputs: dict[str, Any] = field(default_factory=dict)

    # Chat/Q&A results
    qa_results: list[dict[str, str]] = field(default_factory=list)

    def add_result(self, step_name: str, result: StepResult) -> None:
        """Record a step result."""
        self.results[step_name] = result

    def add_error(self, step_name: str, error: str, exception: Exception | None = None) -> None:
        """Record an error."""
        self.errors.append(
            {
                "step": step_name,
                "error": error,
                "exception_type": type(exception).__name__ if exception else None,
                "timestamp": datetime.now().isoformat(),
            }
        )

    def get_result(self, step_name: str) -> StepResult | None:
        """Get result from a previous step."""
        return self.results.get(step_name)

    def get_variable(self, name: str, default: Any = None) -> Any:
        """Get a variable value for template substitution."""
        return self.variables.get(name, default)

    def set_variable(self, name: str, value: Any) -> None:
        """Set a variable for template substitution."""
        self.variables[name] = value

    @property
    def is_running(self) -> bool:
        """Check if pipeline is currently running."""
        return self.status == PipelineStatus.RUNNING

    @property
    def is_completed(self) -> bool:
        """Check if pipeline completed successfully."""
        return self.status == PipelineStatus.COMPLETED

    @property
    def is_failed(self) -> bool:
        """Check if pipeline failed."""
        return self.status == PipelineStatus.FAILED

    @property
    def duration_seconds(self) -> float | None:
        """Get total pipeline duration in seconds."""
        if self.started_at and self.completed_at:
            return (self.completed_at - self.started_at).total_seconds()
        return None

    def to_dict(self) -> dict[str, Any]:
        """Convert context to dictionary for serialization."""
        return {
            "pipeline_id": self.pipeline_id,
            "pipeline_name": self.pipeline_name,
            "notebook_id": self.notebook_id,
            "notebook_title": self.notebook_title,
            "notebook_url": self.notebook_url,
            "source_ids": self.source_ids,
            "artifact_ids": self.artifact_ids,
            "status": self.status.value,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "duration_seconds": self.duration_seconds,
            "variables": self.variables,
            "errors": self.errors,
            "qa_results": self.qa_results,
            "results": {
                name: {
                    "success": r.success,
                    "error": r.error,
                    "duration_seconds": r.duration_seconds,
                }
                for name, r in self.results.items()
            },
        }
