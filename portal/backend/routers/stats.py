from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter

from ..database import get_supabase
from ..repositories import library_notebooks as folio_repo

router = APIRouter(prefix="/api/counts", tags=["stats"])


def _count_corpora(db) -> int:
    # Same set the NotebookLM page shows: non-hidden notebooks with a
    # non-blank title. Counted in Postgres (head request, no rows returned).
    res = (
        db.table("notebooks")
        .select("id", count="exact", head=True)
        .eq("hidden", False)
        .filter("title", "not.match", r"^\s*$")
        .execute()
    )
    return res.count or 0


# Masthead "N CORPORA · M FOLIOS". Replaces fetching both full lists on every
# navigation just to count them. Plain `def`: FastAPI runs it in its
# threadpool, so the synchronous Supabase calls don't block the event loop.
@router.get("")
def archive_counts() -> dict[str, int]:
    db = get_supabase()
    with ThreadPoolExecutor(max_workers=2) as pool:
        corpora = pool.submit(_count_corpora, db)
        folios = pool.submit(folio_repo.count_visible, db)
        return {"corpora": corpora.result(), "folios": folios.result()}
