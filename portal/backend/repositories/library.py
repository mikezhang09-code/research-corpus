from __future__ import annotations

from uuid import UUID

from supabase import Client

from ..models import LibraryFilters, LibraryItemCreate, LibraryItemUpdate

TABLE = "library_items"


def create(
    db: Client,
    data: LibraryItemCreate,
    r2_key: str | None = None,
    r2_url: str | None = None,
    file_size_bytes: int | None = None,
) -> dict:
    row = data.model_dump(mode="json", exclude_none=True)
    if r2_key:
        row["r2_key"] = r2_key
    if r2_url:
        row["r2_url"] = r2_url
    if file_size_bytes:
        row["file_size_bytes"] = file_size_bytes
    return db.table(TABLE).insert(row).execute().data[0]


def get(db: Client, item_id: UUID) -> dict | None:
    rows = db.table(TABLE).select("*").eq("id", str(item_id)).execute().data
    return rows[0] if rows else None


def list_all(db: Client, filters: LibraryFilters) -> tuple[list[dict], int]:
    q = db.table(TABLE).select("*", count="exact")
    if filters.source_type:
        q = q.eq("source_type", filters.source_type)
    if filters.file_ext:
        q = q.eq("file_ext", filters.file_ext)
    if filters.collection:
        q = q.eq("collection", filters.collection)
    if filters.tag:
        q = q.contains("tags", [filters.tag])
    if filters.search:
        q = q.ilike("title", f"%{filters.search}%")
    q = q.order("added_at", desc=True).range(filters.offset, filters.offset + filters.limit - 1)
    resp = q.execute()
    return resp.data, resp.count or 0


def update(db: Client, item_id: UUID, data: LibraryItemUpdate) -> dict | None:
    patch = {k: v for k, v in data.model_dump(mode="json").items() if v is not None}
    if not patch:
        return get(db, item_id)
    rows = db.table(TABLE).update(patch).eq("id", str(item_id)).execute().data
    return rows[0] if rows else None


def delete(db: Client, item_id: UUID) -> dict | None:
    rows = db.table(TABLE).delete().eq("id", str(item_id)).execute().data
    return rows[0] if rows else None


def list_collections(db: Client) -> list[str]:
    rows = db.table(TABLE).select("collection").not_.is_("collection", "null").execute().data
    return sorted({r["collection"] for r in rows if r.get("collection")})


# ---------------------------------------------------------------------------
# Free-form files: library_items with notebook_id IS NULL.
# Every query carries the IS NULL guard so these helpers can never read or
# mutate a folio-owned file.
# ---------------------------------------------------------------------------


def list_free(
    db: Client,
    category: str | None = None,
    tag: str | None = None,
    search: str | None = None,
) -> list[dict]:
    q = db.table(TABLE).select("*").is_("notebook_id", "null")
    if category:
        q = q.eq("file_category", category)
    if tag:
        q = q.contains("tags", [tag])
    if search:
        q = q.ilike("title", f"%{search}%")
    return q.order("added_at", desc=True).execute().data


def get_free(db: Client, item_id: UUID) -> dict | None:
    rows = (
        db.table(TABLE)
        .select("*")
        .eq("id", str(item_id))
        .is_("notebook_id", "null")
        .execute()
        .data
    )
    return rows[0] if rows else None


def update_free(db: Client, item_id: UUID, patch: dict) -> dict | None:
    if not patch:
        return get_free(db, item_id)
    rows = (
        db.table(TABLE)
        .update(patch)
        .eq("id", str(item_id))
        .is_("notebook_id", "null")
        .execute()
        .data
    )
    return rows[0] if rows else None


def delete_free(db: Client, item_id: UUID) -> dict | None:
    rows = (
        db.table(TABLE)
        .delete()
        .eq("id", str(item_id))
        .is_("notebook_id", "null")
        .execute()
        .data
    )
    return rows[0] if rows else None
