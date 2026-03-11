"""Living document management CLI commands.

Commands:
    list         List all registered living documents
    register     Register a Drive file as a living document
    remove       Unregister a living document
    check-stale  Check which documents need syncing
    sync         Sync all stale documents
    templates    List available document templates
"""

import click
from rich.table import Table

from ..client import NotebookLMClient
from .helpers import (
    console,
    json_output_response,
    require_notebook,
    resolve_notebook_id,
    with_client,
)


@click.group("living-doc")
def living_doc():
    """Living document management commands.

    \b
    Living documents are Google Drive files that auto-sync with notebooks.
    Register a doc once, then use check-stale and sync to keep it current.

    \b
    Commands:
      list         List registered living documents
      register     Register a Drive file linked to a notebook
      remove       Unregister a living document
      check-stale  Check which documents need syncing
      sync         Sync all stale documents
      templates    List available templates
    """
    pass


@living_doc.command("list")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@with_client
def living_doc_list(ctx, json_output, client_auth):
    """List all registered living documents."""

    async def _run():
        async with NotebookLMClient(client_auth) as client:
            docs = client.living_docs.list()

            if json_output:
                from dataclasses import asdict

                data = {
                    "documents": [asdict(d) for d in docs],
                    "count": len(docs),
                }
                json_output_response(data)
                return

            if not docs:
                console.print("[yellow]No living documents registered[/yellow]")
                console.print("[dim]Use 'living-doc register' to add one[/dim]")
                return

            table = Table(title="Living Documents")
            table.add_column("Drive File ID", style="cyan")
            table.add_column("Title", style="green")
            table.add_column("Notebook", style="dim")
            table.add_column("Source ID", style="dim")
            table.add_column("Last Synced", style="yellow")

            for doc in docs:
                table.add_row(
                    doc.drive_file_id[:16] + "...",
                    doc.title or "-",
                    doc.notebook_id[:12] + "...",
                    (doc.source_id[:12] + "...") if doc.source_id else "-",
                    doc.last_synced_at or "never",
                )

            console.print(table)

    return _run()


@living_doc.command("register")
@click.argument("drive_file_id")
@click.option(
    "-n",
    "--notebook",
    "notebook_id",
    default=None,
    help="Notebook ID (uses current if not set)",
)
@click.option("--title", default=None, help="Display title for the document")
@click.option(
    "--mime-type",
    type=click.Choice(["google-doc", "google-slides", "google-sheets", "pdf"]),
    default="google-doc",
    help="Document type (default: google-doc)",
)
@click.option("--template", default=None, help="Template ID for categorization")
@click.option(
    "--no-add",
    is_flag=True,
    help="Register only, don't add as notebook source",
)
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@with_client
def living_doc_register(
    ctx, drive_file_id, notebook_id, title, mime_type, template, no_add, json_output, client_auth
):
    """Register a Drive file as a living document.

    Links a Google Drive file to a notebook so it can be monitored
    for changes and synced automatically.

    \b
    Examples:
      living-doc register 1abc123 --title "Master Timeline"
      living-doc register 1abc123 -n nb_456 --template timeline-master
      living-doc register 1abc123 --mime-type google-sheets --no-add
    """
    from ..rpc import DriveMimeType

    nb_id = require_notebook(notebook_id)

    mime_map = {
        "google-doc": DriveMimeType.GOOGLE_DOC.value,
        "google-slides": DriveMimeType.GOOGLE_SLIDES.value,
        "google-sheets": DriveMimeType.GOOGLE_SHEETS.value,
        "pdf": DriveMimeType.PDF.value,
    }
    mime = mime_map[mime_type]

    async def _run():
        async with NotebookLMClient(client_auth) as client:
            nb_id_resolved = await resolve_notebook_id(client, nb_id)

            with console.status("Registering living document..."):
                doc = await client.living_docs.register(
                    drive_file_id=drive_file_id,
                    notebook_id=nb_id_resolved,
                    title=title,
                    mime_type=mime,
                    template=template,
                    add_to_notebook=not no_add,
                )

            if json_output:
                from dataclasses import asdict

                json_output_response(asdict(doc))
                return

            console.print(f"[green]Registered living document:[/green] {doc.drive_file_id}")
            if doc.title:
                console.print(f"[bold]Title:[/bold] {doc.title}")
            if doc.source_id:
                console.print(f"[bold]Source ID:[/bold] {doc.source_id}")
            if doc.template:
                console.print(f"[bold]Template:[/bold] {doc.template}")

    return _run()


@living_doc.command("remove")
@click.argument("drive_file_id")
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation")
@with_client
def living_doc_remove(ctx, drive_file_id, yes, client_auth):
    """Remove a living document from the registry.

    This only removes the tracking entry. It does NOT delete the source
    from NotebookLM or the file from Google Drive.
    """

    async def _run():
        async with NotebookLMClient(client_auth) as client:
            if not yes and not click.confirm(f"Unregister living document {drive_file_id}?"):
                return

            removed = client.living_docs.remove(drive_file_id)
            if removed:
                console.print(f"[green]Removed living document:[/green] {drive_file_id}")
            else:
                console.print("[yellow]Document not found in registry[/yellow]")

    return _run()


@living_doc.command("check-stale")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@with_client
def living_doc_check_stale(ctx, json_output, client_auth):
    """Check which living documents need syncing."""

    async def _run():
        async with NotebookLMClient(client_auth) as client:
            with console.status("Checking document freshness..."):
                result = await client.living_docs.check_stale()

            if json_output:
                from dataclasses import asdict

                data = {
                    "stale": [asdict(d) for d in result.stale],
                    "stale_count": result.stale_count,
                    "fresh": [asdict(d) for d in result.fresh],
                    "fresh_count": result.fresh_count,
                    "errors": result.errors,
                    "total_documents": result.total_documents,
                }
                json_output_response(data)
                return

            if result.total_documents == 0:
                console.print("[yellow]No living documents registered[/yellow]")
                return

            if result.stale:
                console.print(f"[yellow]Stale documents ({result.stale_count}):[/yellow]")
                for doc in result.stale:
                    console.print(f"  - {doc.title or doc.drive_file_id}")
                console.print("\n[dim]Run 'living-doc sync' to refresh[/dim]")
            else:
                console.print(f"[green]All {result.fresh_count} documents are fresh[/green]")

            if result.errors:
                console.print(f"\n[red]Errors ({len(result.errors)}):[/red]")
                for err in result.errors:
                    console.print(f"  - {err['drive_file_id']}: {err['error']}")

    return _run()


@living_doc.command("sync")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@with_client
def living_doc_sync(ctx, json_output, client_auth):
    """Sync all stale living documents by refreshing their sources."""

    async def _run():
        async with NotebookLMClient(client_auth) as client:
            with console.status("Syncing living documents..."):
                result = await client.living_docs.sync_all()

            if json_output:
                from dataclasses import asdict

                data = {
                    "synced": [asdict(d) for d in result.synced],
                    "synced_count": result.synced_count,
                    "skipped": [asdict(d) for d in result.skipped],
                    "errors": result.errors,
                }
                json_output_response(data)
                return

            if result.synced:
                console.print(f"[green]Synced {result.synced_count} document(s):[/green]")
                for doc in result.synced:
                    console.print(f"  - {doc.title or doc.drive_file_id}")

            if result.skipped:
                console.print(f"[dim]Skipped {len(result.skipped)} fresh document(s)[/dim]")

            if result.errors:
                console.print(f"\n[red]Errors ({len(result.errors)}):[/red]")
                for err in result.errors:
                    console.print(f"  - {err['drive_file_id']}: {err['error']}")

            if not result.synced and not result.errors:
                console.print("[green]All documents are already up to date[/green]")

    return _run()


@living_doc.command("templates")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@with_client
def living_doc_templates(ctx, json_output, client_auth):
    """List available living document templates."""

    async def _run():
        async with NotebookLMClient(client_auth) as client:
            templates = client.living_docs.templates()

            if json_output:
                json_output_response({"templates": templates})
                return

            table = Table(title="Living Document Templates")
            table.add_column("Template ID", style="cyan")
            table.add_column("Title", style="green")
            table.add_column("Description")
            table.add_column("Suggested Notebooks", style="dim")

            for tid, tmpl in templates.items():
                table.add_row(
                    tid,
                    tmpl["title"],
                    tmpl["description"],
                    ", ".join(tmpl["suggested_notebooks"]),
                )

            console.print(table)

    return _run()
