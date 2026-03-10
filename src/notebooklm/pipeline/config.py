"""Pipeline configuration loading and validation.

Supports YAML pipeline definitions with Jinja2 variable substitution.
"""

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

# Jinja2 is optional - use simple substitution if not available
try:
    from jinja2 import BaseLoader, Environment, TemplateError

    JINJA2_AVAILABLE = True
except ImportError:
    JINJA2_AVAILABLE = False
    Environment = None
    BaseLoader = None
    TemplateError = Exception


class PipelineConfigError(Exception):
    """Error in pipeline configuration."""

    pass


class PipelineValidationError(PipelineConfigError):
    """Validation error in pipeline configuration."""

    pass


@dataclass
class StepConfig:
    """Configuration for a single pipeline step."""

    name: str
    type: str  # e.g., "builtin:create_notebook", "source:youtube", "tool:notebooklm"
    config: dict[str, Any] = field(default_factory=dict)
    when: str | None = None  # Optional condition expression
    timeout: int | None = None  # Optional timeout in seconds

    @property
    def step_type(self) -> str:
        """Get the step type (builtin, source, tool, exporter)."""
        if ":" in self.type:
            return self.type.split(":")[0]
        return "builtin"

    @property
    def step_handler(self) -> str:
        """Get the step handler name."""
        if ":" in self.type:
            return self.type.split(":", 1)[1]
        return self.type


@dataclass
class PipelineConfig:
    """Complete pipeline configuration."""

    name: str
    description: str = ""
    variables: dict[str, Any] = field(default_factory=dict)
    steps: list[StepConfig] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "PipelineConfig":
        """Create PipelineConfig from dictionary."""
        pipeline_data = data.get("pipeline", {})
        name = pipeline_data.get("name", "unnamed")
        description = pipeline_data.get("description", "")

        # Parse variables
        variables = data.get("variables", {})

        # Parse steps
        steps = []
        for step_data in data.get("steps", []):
            steps.append(
                StepConfig(
                    name=step_data.get("name", ""),
                    type=step_data.get("type", ""),
                    config=step_data.get("config", {}),
                    when=step_data.get("when"),
                    timeout=step_data.get("timeout"),
                )
            )

        return cls(
            name=name,
            description=description,
            variables=variables,
            steps=steps,
            metadata=data.get("metadata", {}),
        )

    def validate(self) -> list[str]:
        """Validate the pipeline configuration.

        Returns:
            List of validation error messages (empty if valid).
        """
        errors = []

        if not self.name:
            errors.append("Pipeline name is required")

        if not self.steps:
            errors.append("Pipeline must have at least one step")

        step_names = set()
        for i, step in enumerate(self.steps):
            if not step.name:
                errors.append(f"Step {i + 1} is missing a name")
            elif step.name in step_names:
                errors.append(f"Duplicate step name: {step.name}")
            else:
                step_names.add(step.name)

            if not step.type:
                errors.append(f"Step '{step.name or i + 1}' is missing a type")

        return errors


def slugify(text: str) -> str:
    """Convert text to URL-friendly slug."""
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[-\s]+", "-", text)
    return text


def _create_jinja_env() -> Any:
    """Create Jinja2 environment with custom filters."""
    if not JINJA2_AVAILABLE:
        return None

    env = Environment(loader=BaseLoader())
    env.filters["slugify"] = slugify
    return env


def _simple_substitute(template: str, variables: dict[str, Any]) -> str:
    """Simple variable substitution without Jinja2.

    Supports {{ variable }} syntax but not filters or complex expressions.
    """
    result = template
    for key, value in variables.items():
        pattern = r"\{\{\s*" + re.escape(key) + r"\s*\}\}"
        result = re.sub(pattern, str(value) if value is not None else "", result)
    return result


def substitute_variables(value: Any, variables: dict[str, Any]) -> Any:
    """Recursively substitute variables in a value.

    Supports Jinja2 templates ({{ variable }}, {{ var | filter }}) if available,
    falls back to simple substitution otherwise.

    Args:
        value: Value to process (string, dict, list, or other)
        variables: Variable name -> value mapping

    Returns:
        Value with variables substituted
    """
    if isinstance(value, str):
        if "{{" not in value:
            return value

        if JINJA2_AVAILABLE:
            try:
                env = _create_jinja_env()
                template = env.from_string(value)
                return template.render(**variables)
            except TemplateError:
                # Fall back to simple substitution on Jinja errors
                return _simple_substitute(value, variables)
        else:
            return _simple_substitute(value, variables)

    elif isinstance(value, dict):
        return {k: substitute_variables(v, variables) for k, v in value.items()}

    elif isinstance(value, list):
        return [substitute_variables(item, variables) for item in value]

    else:
        return value


def load_pipeline_config(
    path: Path | str,
    variables: dict[str, Any] | None = None,
) -> PipelineConfig:
    """Load pipeline configuration from YAML file.

    Args:
        path: Path to YAML configuration file
        variables: Runtime variables to merge with config variables

    Returns:
        PipelineConfig object

    Raises:
        PipelineConfigError: If file cannot be loaded
        PipelineValidationError: If configuration is invalid
    """
    path = Path(path)

    if not path.exists():
        raise PipelineConfigError(f"Pipeline config not found: {path}")

    try:
        with open(path, encoding="utf-8") as f:
            raw_data = yaml.safe_load(f)
    except yaml.YAMLError as e:
        raise PipelineConfigError(f"Invalid YAML in {path}: {e}") from e

    if not isinstance(raw_data, dict):
        raise PipelineConfigError(f"Pipeline config must be a YAML mapping: {path}")

    # Merge runtime variables with config variables
    all_variables = {**raw_data.get("variables", {}), **(variables or {})}

    # Substitute variables in the entire config
    substituted_data = substitute_variables(raw_data, all_variables)
    substituted_data["variables"] = all_variables

    # Parse into PipelineConfig
    config = PipelineConfig.from_dict(substituted_data)

    # Validate
    errors = config.validate()
    if errors:
        raise PipelineValidationError(
            "Pipeline config validation failed:\n" + "\n".join(f"  - {e}" for e in errors)
        )

    return config


def validate_pipeline_file(path: Path | str) -> tuple[bool, list[str]]:
    """Validate a pipeline configuration file.

    Args:
        path: Path to YAML configuration file

    Returns:
        Tuple of (is_valid, error_messages)
    """
    try:
        config = load_pipeline_config(path)
        errors = config.validate()
        return len(errors) == 0, errors
    except PipelineConfigError as e:
        return False, [str(e)]
