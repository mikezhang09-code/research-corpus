from __future__ import annotations

from uuid import UUID

from supabase import Client

NOTEBOOK_TABLE = "library_notebooks"
CHAT_TABLE = "library_notebook_chat"
ITEMS_TABLE = "library_items"


def create(db: Client, title: str, cover_emoji: str | None = None) -> dict:
    row: dict = {"title": title}
    if cover_emoji:
        row["cover_emoji"] = cover_emoji
    return db.table(NOTEBOOK_TABLE).insert(row).execute().data[0]


def get(db: Client, nb_id: UUID) -> dict | None:
    rows = db.table(NOTEBOOK_TABLE).select("*").eq("id", str(nb_id)).execute().data
    return rows[0] if rows else None


def list_all(db: Client, include_hidden: bool = False) -> list[dict]:
    q = db.table(NOTEBOOK_TABLE).select("*")
    if not include_hidden:
        q = q.eq("hidden", False)
    return q.order("created_at", desc=True).execute().data


def update(db: Client, nb_id: UUID, patch: dict) -> dict | None:
    patch["updated_at"] = "now()"
    rows = db.table(NOTEBOOK_TABLE).update(patch).eq("id", str(nb_id)).execute().data
    return rows[0] if rows else None


def delete(db: Client, nb_id: UUID) -> None:
    db.table(NOTEBOOK_TABLE).delete().eq("id", str(nb_id)).execute()


def hide(db: Client, nb_id: UUID) -> dict | None:
    rows = db.table(NOTEBOOK_TABLE).update({"hidden": True}).eq("id", str(nb_id)).execute().data
    return rows[0] if rows else None


def restore(db: Client, nb_id: UUID) -> dict | None:
    rows = db.table(NOTEBOOK_TABLE).update({"hidden": False}).eq("id", str(nb_id)).execute().data
    return rows[0] if rows else None


def get_file_counts(db: Client) -> dict[str, int]:
    """Return {notebook_id: count} for all notebooks."""
    rows = db.table(ITEMS_TABLE).select("notebook_id").not_.is_("notebook_id", "null").execute().data
    counts: dict[str, int] = {}
    for row in rows:
        nid = row.get("notebook_id")
        if nid:
            counts[nid] = counts.get(nid, 0) + 1
    return counts


def get_file_count(db: Client, nb_id: UUID) -> int:
    rows = db.table(ITEMS_TABLE).select("id").eq("notebook_id", str(nb_id)).execute().data
    return len(rows)


def list_files(db: Client, nb_id: UUID, category: str | None = None) -> list[dict]:
    q = db.table(ITEMS_TABLE).select("*").eq("notebook_id", str(nb_id))
    if category:
        q = q.eq("file_category", category)
    return q.order("added_at", desc=True).execute().data


def get_file(db: Client, nb_id: UUID, file_id: UUID) -> dict | None:
    rows = (
        db.table(ITEMS_TABLE)
        .select("*")
        .eq("id", str(file_id))
        .eq("notebook_id", str(nb_id))
        .execute()
        .data
    )
    return rows[0] if rows else None


def delete_file(db: Client, nb_id: UUID, file_id: UUID) -> dict | None:
    rows = (
        db.table(ITEMS_TABLE)
        .delete()
        .eq("id", str(file_id))
        .eq("notebook_id", str(nb_id))
        .execute()
        .data
    )
    return rows[0] if rows else None


def get_chat_history(db: Client, nb_id: UUID, limit: int = 40) -> list[dict]:
    return (
        db.table(CHAT_TABLE)
        .select("*")
        .eq("notebook_id", str(nb_id))
        .order("created_at", desc=False)
        .limit(limit)
        .execute()
        .data
    )


def append_chat(db: Client, nb_id: UUID, role: str, content: str) -> dict:
    return (
        db.table(CHAT_TABLE)
        .insert({"notebook_id": str(nb_id), "role": role, "content": content})
        .execute()
        .data[0]
    )


def clear_chat_history(db: Client, nb_id: UUID) -> None:
    db.table(CHAT_TABLE).delete().eq("notebook_id", str(nb_id)).execute()
