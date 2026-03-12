"""Notebook management CLI commands.

Commands:
    list       List all notebooks
    create     Create a new notebook
    delete     Delete a notebook
    rename     Rename a notebook
    summary    Get notebook summary with AI-generated insights

Note: Sharing commands moved to 'share' command group.
"""

import click
from rich.table import Table

from ..client import NotebookLMClient
from .helpers import (
    clear_context,
    console,
    get_current_notebook,
    json_output_response,
    require_notebook,
    resolve_notebook_id,
    with_client,
)


def register_notebook_commands(cli):
    """Register notebook commands on the main CLI group."""

    @cli.command("list")
    @click.option("--json", "json_output", is_flag=True, help="Output as JSON")
    @with_client
    def list_cmd(ctx, json_output, client_auth):
        """List all notebooks."""

        async def _run():
            async with NotebookLMClient(client_auth) as client:
                notebooks = await client.notebooks.list()

                if json_output:
                    data = {
                        "notebooks": [
                            {
                                "index": i,
                                "id": nb.id,
                                "title": nb.title,
                                "is_owner": nb.is_owner,
                                "created_at": nb.created_at.isoformat() if nb.created_at else None,
                            }
                            for i, nb in enumerate(notebooks, 1)
                        ],
                        "count": len(notebooks),
                    }
                    json_output_response(data)
                    return

                table = Table(title="Notebooks")
                table.add_column("ID", style="cyan")
                table.add_column("Title", style="green")
                table.add_column("Owner")
                table.add_column("Created", style="dim")

                for nb in notebooks:
                    created = nb.created_at.strftime("%Y-%m-%d") if nb.created_at else "-"
                    owner_status = "Owner" if nb.is_owner else "Shared"
                    table.add_row(nb.id, nb.title, owner_status, created)

                console.print(table)

        return _run()

    @cli.command("create")
    @click.argument("title")
    @click.option("--json", "json_output", is_flag=True, help="Output as JSON")
    @with_client
    def create_cmd(ctx, title, json_output, client_auth):
        """Create a new notebook."""

        async def _run():
            async with NotebookLMClient(client_auth) as client:
                nb = await client.notebooks.create(title)

                if json_output:
                    data = {
                        "notebook": {
                            "id": nb.id,
                            "title": nb.title,
                            "created_at": nb.created_at.isoformat() if nb.created_at else None,
                        }
                    }
                    json_output_response(data)
                    return

                console.print(f"[green]Created notebook:[/green] {nb.id} - {nb.title}")

        return _run()

    @cli.command("delete")
    @click.option(
        "-n",
        "--notebook",
        "notebook_id",
        default=None,
        help="Notebook ID (uses current if not set). Supports partial IDs.",
    )
    @click.option("--yes", "-y", is_flag=True, help="Skip confirmation")
    @with_client
    def delete_cmd(ctx, notebook_id, yes, client_auth):
        """Delete a notebook.

        Supports partial IDs - 'notebooklm delete -n abc' matches 'abc123...'
        """
        notebook_id = require_notebook(notebook_id)

        async def _run():
            async with NotebookLMClient(client_auth) as client:
                # Resolve partial ID to full ID
                resolved_id = await resolve_notebook_id(client, notebook_id)

                # Confirm after resolution so user sees the full ID
                if not yes and not click.confirm(f"Delete notebook {resolved_id}?"):
                    return

                success = await client.notebooks.delete(resolved_id)
                if success:
                    console.print(f"[green]Deleted notebook:[/green] {resolved_id}")
                    # Clear context if we deleted the current notebook
                    if get_current_notebook() == resolved_id:
                        clear_context()
                        console.print("[dim]Cleared current notebook context[/dim]")
                else:
                    console.print("[yellow]Delete may have failed[/yellow]")

        return _run()

    @cli.command("rename")
    @click.argument("new_title")
    @click.option(
        "-n",
        "--notebook",
        "notebook_id",
        default=None,
        help="Notebook ID (uses current if not set). Supports partial IDs.",
    )
    @with_client
    def rename_cmd(ctx, new_title, notebook_id, client_auth):
        """Rename a notebook.

        NOTEBOOK_ID supports partial matching (e.g., 'abc' matches 'abc123...').
        """
        notebook_id = require_notebook(notebook_id)

        async def _run():
            async with NotebookLMClient(client_auth) as client:
                resolved_id = await resolve_notebook_id(client, notebook_id)
                await client.notebooks.rename(resolved_id, new_title)
                console.print(f"[green]Renamed notebook:[/green] {resolved_id}")
                console.print(f"[bold]New title:[/bold] {new_title}")

        return _run()

    @cli.command("get")
    @click.argument("notebook_id", required=False, default=None)
    @click.option(
        "-n",
        "--notebook",
        "notebook_opt",
        default=None,
        help="Notebook ID (uses current if not set). Supports partial IDs.",
    )
    @click.option("--json", "json_output", is_flag=True, help="Output as JSON")
    @with_client
    def get_cmd(ctx, notebook_id, notebook_opt, json_output, client_auth):
        """Get notebook details.

        NOTEBOOK_ID supports partial matching (e.g., 'abc' matches 'abc123...').
        """
        notebook_id = require_notebook(notebook_id or notebook_opt)

        async def _run():
            async with NotebookLMClient(client_auth) as client:
                resolved_id = await resolve_notebook_id(client, notebook_id)
                nb = await client.notebooks.get(resolved_id)

                if json_output:
                    data = {
                        "notebook": {
                            "id": nb.id,
                            "title": nb.title,
                            "is_owner": nb.is_owner,
                            "sources_count": nb.sources_count,
                            "created_at": nb.created_at.isoformat() if nb.created_at else None,
                        }
                    }
                    json_output_response(data)
                    return

                console.print(f"[bold cyan]Notebook:[/bold cyan] {nb.title}")
                console.print(f"[bold]ID:[/bold] {nb.id}")
                console.print(f"[bold]Owner:[/bold] {'Yes' if nb.is_owner else 'No'}")
                console.print(f"[bold]Sources:[/bold] {nb.sources_count}")
                if nb.created_at:
                    console.print(
                        f"[bold]Created:[/bold] {nb.created_at.strftime('%Y-%m-%d %H:%M')}"
                    )

        return _run()

    @cli.command("health")
    @click.option(
        "-n",
        "--notebook",
        "notebook_id",
        default=None,
        help="Notebook ID (uses current if not set). Supports partial IDs.",
    )
    @click.option("--json", "json_output", is_flag=True, help="Output as JSON")
    @with_client
    def health_cmd(ctx, notebook_id, json_output, client_auth):
        """Audit notebook health - check for empty, stale sources, duplicates.

        NOTEBOOK_ID supports partial matching (e.g., 'abc' matches 'abc123...').
        """
        notebook_id = require_notebook(notebook_id)

        async def _run():
            async with NotebookLMClient(client_auth) as client:
                resolved_id = await resolve_notebook_id(client, notebook_id)
                report = await client.notebooks.health(resolved_id)

                if json_output:
                    data = {
                        "notebook_id": report.notebook_id,
                        "title": report.title,
                        "source_count": report.source_count,
                        "has_sources": report.has_sources,
                        "stale_sources": report.stale_sources,
                        "duplicate_urls": report.duplicate_urls,
                        "status": report.status,
                    }
                    json_output_response(data)
                    return

                status_color = {
                    "healthy": "green",
                    "needs_attention": "yellow",
                    "empty": "red",
                }.get(report.status, "white")

                console.print(f"[bold cyan]Health Report:[/bold cyan] {report.title}")
                console.print(
                    f"[bold]Status:[/bold] [{status_color}]{report.status}[/{status_color}]"
                )
                console.print(f"[bold]Sources:[/bold] {report.source_count}")

                if report.stale_sources:
                    console.print(
                        f"\n[yellow]Stale sources ({len(report.stale_sources)}):[/yellow]"
                    )
                    for sid in report.stale_sources:
                        console.print(f"  - {sid}")

                if report.duplicate_urls:
                    console.print(
                        f"\n[yellow]Duplicate URLs ({len(report.duplicate_urls)}):[/yellow]"
                    )
                    for url in report.duplicate_urls:
                        console.print(f"  - {url}")

        return _run()

    @cli.command("health-all")
    @click.option("--json", "json_output", is_flag=True, help="Output as JSON")
    @with_client
    def health_all_cmd(ctx, json_output, client_auth):
        """Audit health of ALL notebooks."""

        async def _run():
            async with NotebookLMClient(client_auth) as client:
                reports = await client.notebooks.health_all()

                if json_output:
                    data = {
                        "reports": [
                            {
                                "notebook_id": r.notebook_id,
                                "title": r.title,
                                "source_count": r.source_count,
                                "has_sources": r.has_sources,
                                "stale_sources": r.stale_sources,
                                "duplicate_urls": r.duplicate_urls,
                                "status": r.status,
                            }
                            for r in reports
                        ],
                        "count": len(reports),
                    }
                    json_output_response(data)
                    return

                if not reports:
                    console.print("[yellow]No notebooks found[/yellow]")
                    return

                table = Table(title="Notebook Health")
                table.add_column("Title", style="cyan")
                table.add_column("Status")
                table.add_column("Sources", justify="right")
                table.add_column("Stale", justify="right")
                table.add_column("Duplicates", justify="right")

                for r in reports:
                    status_color = {
                        "healthy": "green",
                        "needs_attention": "yellow",
                        "empty": "red",
                    }.get(r.status, "white")
                    table.add_row(
                        r.title,
                        f"[{status_color}]{r.status}[/{status_color}]",
                        str(r.source_count),
                        str(len(r.stale_sources)),
                        str(len(r.duplicate_urls)),
                    )

                console.print(table)

        return _run()

    @cli.command("merge")
    @click.argument("target_notebook_id")
    @click.option(
        "-n",
        "--notebook",
        "notebook_id",
        default=None,
        help="Source notebook ID (uses current if not set). Supports partial IDs.",
    )
    @click.option(
        "--skip-duplicates/--no-skip-duplicates",
        default=True,
        help="Skip sources that already exist in target (default: True)",
    )
    @click.option("--yes", "-y", is_flag=True, help="Skip confirmation")
    @with_client
    def merge_cmd(ctx, target_notebook_id, notebook_id, skip_duplicates, yes, client_auth):
        """Merge sources from current notebook into target notebook.

        Copies all sources from the source notebook into TARGET_NOTEBOOK_ID.
        URL sources are re-added by URL; text sources are copied as text.

        TARGET_NOTEBOOK_ID supports partial matching.
        """
        notebook_id = require_notebook(notebook_id)

        async def _run():
            async with NotebookLMClient(client_auth) as client:
                source_id = await resolve_notebook_id(client, notebook_id)
                target_id = await resolve_notebook_id(client, target_notebook_id)

                if not yes and not click.confirm(
                    f"Merge sources from {source_id} into {target_id}?"
                ):
                    return

                added = await client.notebooks.merge(
                    source_id, target_id, skip_duplicates=skip_duplicates
                )
                console.print(f"[green]Merged {len(added)} source(s)[/green] into {target_id}")

        return _run()

    @cli.command("archive")
    @click.option(
        "-n",
        "--notebook",
        "notebook_id",
        default=None,
        help="Notebook ID (uses current if not set). Supports partial IDs.",
    )
    @with_client
    def archive_cmd(ctx, notebook_id, client_auth):
        """Remove notebook from recently viewed list.

        NOTEBOOK_ID supports partial matching (e.g., 'abc' matches 'abc123...').
        """
        notebook_id = require_notebook(notebook_id)

        async def _run():
            async with NotebookLMClient(client_auth) as client:
                resolved_id = await resolve_notebook_id(client, notebook_id)
                await client.notebooks.remove_from_recent(resolved_id)
                console.print(f"[green]Archived notebook:[/green] {resolved_id}")

        return _run()

    @cli.command("summary")
    @click.option(
        "-n",
        "--notebook",
        "notebook_id",
        default=None,
        help="Notebook ID (uses current if not set). Supports partial IDs.",
    )
    @click.option("--topics", is_flag=True, help="Include suggested topics")
    @with_client
    def summary_cmd(ctx, notebook_id, topics, client_auth):
        """Get notebook summary with AI-generated insights.

        NOTEBOOK_ID supports partial matching (e.g., 'abc' matches 'abc123...').

        \b
        Examples:
          notebooklm summary              # Summary only
          notebooklm summary --topics     # With suggested topics
        """
        notebook_id = require_notebook(notebook_id)

        async def _run():
            async with NotebookLMClient(client_auth) as client:
                resolved_id = await resolve_notebook_id(client, notebook_id)
                description = await client.notebooks.get_description(resolved_id)
                if description and description.summary:
                    console.print("[bold cyan]Summary:[/bold cyan]")
                    console.print(description.summary)

                    if topics and description.suggested_topics:
                        console.print("\n[bold cyan]Suggested Topics:[/bold cyan]")
                        for i, topic in enumerate(description.suggested_topics, 1):
                            console.print(f"  {i}. {topic.question}")
                else:
                    console.print("[yellow]No summary available[/yellow]")

        return _run()
