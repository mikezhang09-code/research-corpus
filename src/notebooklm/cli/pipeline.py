"""Pipeline CLI commands.

Provides CLI commands for running and managing research pipelines:
- notebooklm pipeline run <config.yaml> - Run a pipeline
- notebooklm pipeline list - List available templates
- notebooklm pipeline validate <config.yaml> - Validate configuration
- notebooklm pipeline create <name.yaml> - Create from template
- notebooklm pipeline status - Show pipeline execution status
"""

from pathlib import Path
from typing import Any

import click
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from ..client import NotebookLMClient
from ..pipeline import (
    PipelineConfigError,
    PipelineContext,
    PipelineEngine,
    load_pipeline_config,
    validate_pipeline_file,
)
from .helpers import (
    get_auth_tokens,
    handle_auth_error,
    handle_error,
    json_error_response,
    json_output_response,
    run_async,
)
from .options import json_option

console = Console()


def _get_templates_dir() -> Path:
    """Get the built-in templates directory."""
    return Path(__file__).parent.parent / "data" / "templates"


def _list_template_files() -> list[Path]:
    """List all template YAML files."""
    templates_dir = _get_templates_dir()
    if not templates_dir.exists():
        return []
    return sorted(templates_dir.glob("*.yaml"))


@click.group(name="pipeline")
def pipeline():
    """Research pipeline commands.

    \b
    Run complex research workflows defined in YAML:
      notebooklm pipeline run research.yaml --var topic="AI safety"
      notebooklm pipeline list
      notebooklm pipeline validate my-pipeline.yaml
    """
    pass


@pipeline.command("run")
@click.argument("config_file", type=click.Path(exists=True))
@click.option(
    "--var",
    "-v",
    "variables",
    multiple=True,
    help="Set variable (name=value). Can be used multiple times.",
)
@click.option(
    "--output",
    "-o",
    type=click.Path(),
    help="Output directory for results.",
)
@json_option
@click.pass_context
def run_pipeline(ctx, config_file: str, variables: tuple, output: str | None, json_output: bool):
    """Run a research pipeline from configuration file.

    \b
    Examples:
      notebooklm pipeline run research-to-podcast.yaml
      notebooklm pipeline run research.yaml --var topic="quantum computing"
      notebooklm pipeline run analysis.yaml -v topic="AI" -v depth="deep"
    """
    try:
        auth = get_auth_tokens(ctx)
    except FileNotFoundError:
        handle_auth_error(json_output)
        return

    # Parse variables
    var_dict: dict[str, Any] = {}
    for var in variables:
        if "=" in var:
            key, value = var.split("=", 1)
            var_dict[key.strip()] = value.strip()
        else:
            console.print(
                f"[yellow]Warning: Invalid variable format '{var}' (expected name=value)[/yellow]"
            )

    if output:
        var_dict["output_dir"] = output

    async def _run():
        async with NotebookLMClient(auth) as client:
            # Create engine with progress callback
            def progress_callback(step: str, status: str, current: int, total: int):
                if not json_output:
                    console.print(f"  [{current}/{total}] {step}: {status}")

            engine = PipelineEngine(progress_callback=progress_callback)

            if not json_output:
                console.print(f"[bold]Running pipeline:[/bold] {config_file}")
                console.print(f"[dim]Variables: {var_dict or 'none'}[/dim]\n")

            try:
                result = await engine.run(
                    config_file,
                    client=client,
                    variables=var_dict,
                )

                if json_output:
                    json_output_response(result.to_dict())
                else:
                    _display_pipeline_result(result)

            except PipelineConfigError as e:
                if json_output:
                    json_error_response("CONFIG_ERROR", str(e))
                else:
                    console.print(f"[red]Configuration error:[/red] {e}")
                    raise SystemExit(1) from None

    try:
        run_async(_run())
    except Exception as e:
        if json_output:
            json_error_response("PIPELINE_ERROR", str(e))
        else:
            handle_error(e)


def _display_pipeline_result(ctx: PipelineContext):
    """Display pipeline execution results."""
    # Status panel
    status_color = "green" if ctx.is_completed else "red" if ctx.is_failed else "yellow"
    status_text = ctx.status.value.upper()

    console.print()
    console.print(
        Panel(
            f"[{status_color}]{status_text}[/{status_color}]",
            title=f"Pipeline: {ctx.pipeline_name}",
            expand=False,
        )
    )

    # Notebook info
    if ctx.notebook_id:
        console.print("\n[bold]Notebook:[/bold]")
        console.print(f"  ID: {ctx.notebook_id}")
        if ctx.notebook_title:
            console.print(f"  Title: {ctx.notebook_title}")
        if ctx.notebook_url:
            console.print(f"  URL: [link={ctx.notebook_url}]{ctx.notebook_url}[/link]")

    # Sources and artifacts
    console.print("\n[bold]Results:[/bold]")
    console.print(f"  Sources added: {len(ctx.source_ids)}")
    console.print(f"  Artifacts created: {len(ctx.artifact_ids)}")
    console.print(f"  Questions answered: {len(ctx.qa_results)}")

    # Step results
    if ctx.results:
        console.print("\n[bold]Steps:[/bold]")
        for name, result in ctx.results.items():
            icon = "[green]✓[/green]" if result.success else "[red]✗[/red]"
            duration = f" ({result.duration_seconds:.1f}s)" if result.duration_seconds else ""
            console.print(f"  {icon} {name}{duration}")
            if result.error:
                console.print(f"      [dim red]{result.error}[/dim red]")

    # Errors
    if ctx.errors:
        console.print("\n[bold red]Errors:[/bold red]")
        for error in ctx.errors:
            console.print(f"  • [{error.get('step')}] {error.get('error')}")

    # Duration
    if ctx.duration_seconds:
        console.print(f"\n[dim]Total time: {ctx.duration_seconds:.1f}s[/dim]")


@pipeline.command("list")
@json_option
def list_templates(json_output: bool):
    """List available pipeline templates.

    Shows built-in templates that can be used as starting points.
    """
    templates = _list_template_files()

    if json_output:
        template_data = []
        for t in templates:
            try:
                config = load_pipeline_config(t)
                template_data.append(
                    {
                        "name": t.stem,
                        "file": t.name,
                        "description": config.description,
                        "steps": len(config.steps),
                    }
                )
            except Exception:
                template_data.append(
                    {
                        "name": t.stem,
                        "file": t.name,
                        "description": "Error loading template",
                        "steps": 0,
                    }
                )
        json_output_response({"templates": template_data})
        return

    if not templates:
        console.print("[yellow]No templates found.[/yellow]")
        console.print("[dim]Templates should be in: {_get_templates_dir()}[/dim]")
        return

    table = Table(title="Available Pipeline Templates")
    table.add_column("Name", style="cyan")
    table.add_column("Description")
    table.add_column("Steps", justify="right")

    for template_path in templates:
        try:
            config = load_pipeline_config(template_path)
            table.add_row(
                template_path.stem,
                config.description[:50] + "..."
                if len(config.description) > 50
                else config.description,
                str(len(config.steps)),
            )
        except Exception as e:
            table.add_row(template_path.stem, f"[red]Error: {e}[/red]", "-")

    console.print(table)
    console.print(
        "\n[dim]Use 'notebooklm pipeline create --template <name> <output.yaml>' to copy a template[/dim]"
    )


@pipeline.command("validate")
@click.argument("config_file", type=click.Path(exists=True))
@json_option
def validate_config(config_file: str, json_output: bool):
    """Validate a pipeline configuration file.

    Checks YAML syntax and pipeline structure without running.
    """
    is_valid, errors = validate_pipeline_file(config_file)

    if json_output:
        json_output_response(
            {
                "valid": is_valid,
                "file": config_file,
                "errors": errors,
            }
        )
        return

    if is_valid:
        console.print(f"[green]✓[/green] {config_file} is valid")

        # Show summary
        try:
            config = load_pipeline_config(config_file)
            console.print(f"\n[bold]Pipeline:[/bold] {config.name}")
            if config.description:
                console.print(f"[dim]{config.description}[/dim]")
            console.print(f"\n[bold]Steps ({len(config.steps)}):[/bold]")
            for step in config.steps:
                console.print(f"  • {step.name} ({step.type})")
            if config.variables:
                console.print("\n[bold]Variables:[/bold]")
                for key, value in config.variables.items():
                    display_value = value if value is not None else "[required]"
                    console.print(f"  • {key}: {display_value}")
        except Exception:
            pass
    else:
        console.print(f"[red]✗[/red] {config_file} has errors:")
        for error in errors:
            console.print(f"  • {error}")
        raise SystemExit(1)


@pipeline.command("create")
@click.argument("output_file", type=click.Path())
@click.option(
    "--template",
    "-t",
    "template_name",
    help="Template to copy from (use 'list' to see available).",
)
def create_pipeline(output_file: str, template_name: str | None):
    """Create a new pipeline configuration file.

    \b
    Examples:
      notebooklm pipeline create my-research.yaml
      notebooklm pipeline create my-pipeline.yaml --template research-to-podcast
    """
    output_path = Path(output_file)

    if output_path.exists():
        console.print(f"[red]Error:[/red] {output_file} already exists")
        raise SystemExit(1)

    if template_name:
        # Copy from template
        template_path = _get_templates_dir() / f"{template_name}.yaml"
        if not template_path.exists():
            console.print(f"[red]Error:[/red] Template '{template_name}' not found")
            console.print("[dim]Use 'notebooklm pipeline list' to see available templates[/dim]")
            raise SystemExit(1)

        content = template_path.read_text(encoding="utf-8")
        output_path.write_text(content, encoding="utf-8")
        console.print(f"[green]✓[/green] Created {output_file} from template '{template_name}'")
    else:
        # Create minimal template
        minimal_template = """# Pipeline configuration
pipeline:
  name: "my-pipeline"
  description: "My research pipeline"

variables:
  topic: null  # Required at runtime

steps:
  - name: create_notebook
    type: builtin:create_notebook
    config:
      title: "Research: {{ topic }}"

  - name: add_sources
    type: builtin:ingest
    config:
      sources:
        - plugin: source:url
          url: "https://example.com"

  - name: wait_for_processing
    type: builtin:wait_sources
    config:
      timeout: 300

  - name: generate_content
    type: builtin:synthesize
    config:
      artifacts:
        - type: report
          format: study-guide
      questions:
        - "What are the key points about {{ topic }}?"
"""
        output_path.write_text(minimal_template, encoding="utf-8")
        console.print(f"[green]✓[/green] Created {output_file}")

    console.print("\n[dim]Edit the file, then run:[/dim]")
    console.print(f"  notebooklm pipeline validate {output_file}")
    console.print(f'  notebooklm pipeline run {output_file} --var topic="your topic"')


@pipeline.command("status")
@json_option
def pipeline_status(json_output: bool):
    """Show information about available pipeline steps and plugins.

    Lists all built-in steps and registered plugins.
    """
    from ..pipeline import BUILTIN_STEPS, create_default_registry

    registry = create_default_registry()

    if json_output:
        json_output_response(
            {
                "builtin_steps": list(BUILTIN_STEPS.keys()),
                "plugins": registry.list_plugins(),
            }
        )
        return

    # Built-in steps
    console.print("[bold]Built-in Steps:[/bold]")
    step_descriptions = {
        "create_notebook": "Create a new NotebookLM notebook",
        "ingest": "Add sources to the notebook",
        "wait_sources": "Wait for sources to finish processing",
        "synthesize": "Generate artifacts (audio, reports, etc.)",
        "wait_artifacts": "Wait for artifacts to complete",
        "ask": "Ask questions to the notebook",
        "export": "Export artifacts to files",
    }
    for name in BUILTIN_STEPS:
        desc = step_descriptions.get(name, "")
        console.print(f"  • [cyan]builtin:{name}[/cyan] - {desc}")

    # Plugins
    console.print("\n[bold]Source Plugins:[/bold]")
    for plugin in registry.list_plugins():
        if plugin.startswith("source:"):
            console.print(f"  • [cyan]{plugin}[/cyan]")

    console.print("\n[bold]Tool Plugins:[/bold]")
    for plugin in registry.list_plugins():
        if plugin.startswith("tool:"):
            console.print(f"  • [cyan]{plugin}[/cyan]")

    console.print("\n[bold]Exporter Plugins:[/bold]")
    for plugin in registry.list_plugins():
        if plugin.startswith("exporter:"):
            console.print(f"  • [cyan]{plugin}[/cyan]")
