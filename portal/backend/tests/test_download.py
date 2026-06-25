"""Zip-download endpoints: folio files, free-forms, and saved Corpus artifacts.

Each endpoint streams a zip built in-memory from R2 objects. ``get_file_bytes``
is patched to return deterministic per-key bytes so no real R2 is touched, and
the in-memory ``FakeSupabase`` stands in for the database.
"""

from __future__ import annotations

import io
import sys
import zipfile
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from portal.backend.main import create_app  # noqa: E402


@pytest.fixture
def client(fake_db, monkeypatch):
    for mod in ("library_notebooks", "free_forms", "notebooks"):
        monkeypatch.setattr(f"portal.backend.routers.{mod}.get_supabase", lambda: fake_db)
    # build_zip pulls each object from R2 — return the key as bytes so we can
    # assert exactly which objects landed in the archive.
    monkeypatch.setattr(
        "portal.backend.storage.get_file_bytes", lambda key: f"BYTES:{key}".encode()
    )
    return TestClient(create_app())


def _names(resp) -> set[str]:
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        return set(zf.namelist())


# ---------------------------------------------------------------------------
# Folio files
# ---------------------------------------------------------------------------


def _folio_file(nb_id, **over):
    row = {
        "id": str(uuid4()),
        "notebook_id": nb_id,
        "title": "Doc",
        "original_name": "doc.md",
        "file_ext": ".md",
        "r2_key": f"library/uploads/{uuid4()}/doc.md",
        "added_at": "2026-01-01T00:00:00Z",
    }
    row.update(over)
    return row


def test_folio_download_whole(client, fake_db):
    nb = str(uuid4())
    fake_db.seed("library_notebooks", [{"id": nb, "title": "My Folio"}])
    fake_db.seed(
        "library_items",
        [
            _folio_file(nb, original_name="a.md", r2_key="k/a.md"),
            _folio_file(nb, original_name="b.pdf", r2_key="k/b.pdf"),
        ],
    )
    resp = client.post(f"/api/library-notebooks/{nb}/files/download", json={})
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"
    assert "My Folio.zip" in resp.headers["content-disposition"]
    assert _names(resp) == {"a.md", "b.pdf"}


def test_folio_download_selected_subset(client, fake_db):
    nb = str(uuid4())
    fake_db.seed("library_notebooks", [{"id": nb, "title": "F"}])
    keep = _folio_file(nb, original_name="keep.md", r2_key="k/keep.md")
    drop = _folio_file(nb, original_name="drop.md", r2_key="k/drop.md")
    fake_db.seed("library_items", [keep, drop])

    resp = client.post(
        f"/api/library-notebooks/{nb}/files/download", json={"ids": [keep["id"]]}
    )
    assert resp.status_code == 200
    assert _names(resp) == {"keep.md"}


def test_folio_download_rejects_foreign_id(client, fake_db):
    nb = str(uuid4())
    fake_db.seed("library_notebooks", [{"id": nb, "title": "F"}])
    fake_db.seed("library_items", [_folio_file(nb)])
    resp = client.post(
        f"/api/library-notebooks/{nb}/files/download", json={"ids": [str(uuid4())]}
    )
    assert resp.status_code == 404


def test_folio_download_dedupes_colliding_names(client, fake_db):
    nb = str(uuid4())
    fake_db.seed("library_notebooks", [{"id": nb, "title": "F"}])
    fake_db.seed(
        "library_items",
        [
            _folio_file(nb, original_name="report.md", r2_key="k/1.md"),
            _folio_file(nb, original_name="report.md", r2_key="k/2.md"),
        ],
    )
    resp = client.post(f"/api/library-notebooks/{nb}/files/download", json={})
    assert resp.status_code == 200
    assert _names(resp) == {"report.md", "report (2).md"}


def test_folio_download_404_when_empty(client, fake_db):
    nb = str(uuid4())
    fake_db.seed("library_notebooks", [{"id": nb, "title": "F"}])
    resp = client.post(f"/api/library-notebooks/{nb}/files/download", json={})
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Free forms
# ---------------------------------------------------------------------------


def _free_file(**over):
    row = {
        "id": str(uuid4()),
        "notebook_id": None,
        "title": "Free",
        "original_name": "free.md",
        "file_ext": ".md",
        "r2_key": f"library/uploads/{uuid4()}/free.md",
        "added_at": "2026-01-01T00:00:00Z",
    }
    row.update(over)
    return row


def test_free_forms_download_whole(client, fake_db):
    fake_db.seed(
        "library_items",
        [
            _free_file(original_name="x.md", r2_key="k/x.md"),
            _free_file(original_name="y.csv", r2_key="k/y.csv"),
            # A folio-owned file must NOT leak into the free-forms zip.
            {**_free_file(original_name="folio.md", r2_key="k/folio.md"), "notebook_id": "nb-9"},
        ],
    )
    resp = client.post("/api/free-forms/download", json={})
    assert resp.status_code == 200
    assert "free-forms.zip" in resp.headers["content-disposition"]
    assert _names(resp) == {"x.md", "y.csv"}


def test_free_forms_download_selected(client, fake_db):
    a = _free_file(original_name="a.md", r2_key="k/a.md")
    b = _free_file(original_name="b.md", r2_key="k/b.md")
    fake_db.seed("library_items", [a, b])
    resp = client.post("/api/free-forms/download", json={"ids": [b["id"]]})
    assert resp.status_code == 200
    assert _names(resp) == {"b.md"}


# ---------------------------------------------------------------------------
# Corpus artifacts (saved-only)
# ---------------------------------------------------------------------------


def _artifact(**over):
    row = {
        "id": str(uuid4()),
        "notebook_id": "nb-1",
        "title": "Report",
        "artifact_type": "report",
        "file_format": "md",
        "download_status": "done",
        "r2_key": f"notebooklm/nb-1/report/{uuid4()}.md",
    }
    row.update(over)
    return row


def test_artifacts_download_saved_only_with_skip_header(client, fake_db):
    fake_db.seed("notebooks", [{"id": "nb-1", "title": "Corpus NB"}])
    fake_db.seed(
        "nlm_artifacts",
        [
            _artifact(title="Done A", r2_key="k/a.md"),
            _artifact(title="Done B", file_format="csv", r2_key="k/b.csv"),
            _artifact(title="Pending", download_status="pending", r2_key=None),
        ],
    )
    resp = client.post("/api/notebooks/nb-1/artifacts/download", json={})
    assert resp.status_code == 200
    assert "Corpus NB.zip" in resp.headers["content-disposition"]
    assert resp.headers["X-Skipped-Count"] == "1"
    assert _names(resp) == {"Done A.md", "Done B.csv"}


def test_artifacts_download_selected_reports_skipped(client, fake_db):
    fake_db.seed("notebooks", [{"id": "nb-1", "title": "NB"}])
    done = _artifact(title="Saved", r2_key="k/s.md")
    pending = _artifact(title="Unsaved", download_status="pending", r2_key=None)
    fake_db.seed("nlm_artifacts", [done, pending])

    resp = client.post(
        "/api/notebooks/nb-1/artifacts/download",
        json={"ids": [done["id"], pending["id"]]},
    )
    assert resp.status_code == 200
    assert resp.headers["X-Skipped-Count"] == "1"
    assert _names(resp) == {"Saved.md"}


def test_artifacts_download_404_when_none_saved(client, fake_db):
    fake_db.seed("notebooks", [{"id": "nb-1", "title": "NB"}])
    fake_db.seed("nlm_artifacts", [_artifact(download_status="pending", r2_key=None)])
    resp = client.post("/api/notebooks/nb-1/artifacts/download", json={})
    assert resp.status_code == 404
