"""Phase 3 — router/API smoke tests via FastAPI TestClient.

The app is built per test and the routers' module-level ``get_supabase`` is
patched to the in-memory FakeSupabase. The TestClient is used WITHOUT a
context manager so the lifespan (which would build real Supabase/R2 clients)
never runs.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from portal.backend.main import create_app
from portal.backend.tests.conftest import FakeArtifacts, _Status

# Column defaults that the real nlm_artifacts table fills in, so rows satisfy
# the NLMArtifactRead response model.
_ARTIFACT_DEFAULTS = {
    "notebook_id": None,
    "notebook_title": None,
    "title": "",
    "summary": "",
    "r2_key": None,
    "r2_url": None,
    "file_size_bytes": None,
    "download_status": "generating",
    "downloaded_at": None,
    "download_error": None,
    "nlm_created_at": None,
    "tags": [],
    "notes": "",
    "library_item_id": None,
    # Real table fills this via DEFAULT now(); fixed value is fine for tests.
    "portal_added_at": "2026-01-01T00:00:00+00:00",
}


def _full_artifact_row(**over):
    row = {
        "id": str(uuid4()),
        "nlm_artifact_id": "nlm-1",
        "artifact_type": "report",
        "file_format": "md",
        "portal_added_at": datetime.now(timezone.utc).isoformat(),
        **_ARTIFACT_DEFAULTS,
    }
    row.update(over)
    return row


@pytest.fixture
def client(fake_db, monkeypatch):
    fake_db.defaults["nlm_artifacts"] = _ARTIFACT_DEFAULTS
    monkeypatch.setattr("portal.backend.routers.artifacts.get_supabase", lambda: fake_db)
    monkeypatch.setattr("portal.backend.routers.notebooks.get_supabase", lambda: fake_db)
    return TestClient(create_app())


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------


def test_health(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


# ---------------------------------------------------------------------------
# Artifacts router
# ---------------------------------------------------------------------------


def test_list_artifacts(client, fake_db):
    fake_db.seed("nlm_artifacts", [_full_artifact_row(title="A"), _full_artifact_row(title="B")])
    resp = client.get("/api/artifacts")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    assert {i["title"] for i in body["items"]} == {"A", "B"}


def test_list_artifacts_filtered_by_type(client, fake_db):
    fake_db.seed(
        "nlm_artifacts",
        [
            _full_artifact_row(title="rep", artifact_type="report"),
            _full_artifact_row(title="aud", artifact_type="audio"),
        ],
    )
    resp = client.get("/api/artifacts", params={"artifact_type": "audio"})
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert [i["title"] for i in items] == ["aud"]


def test_get_artifact_found_and_missing(client, fake_db):
    row = _full_artifact_row(title="One")
    fake_db.seed("nlm_artifacts", [row])

    ok = client.get(f"/api/artifacts/{row['id']}")
    assert ok.status_code == 200
    assert ok.json()["title"] == "One"

    missing = client.get(f"/api/artifacts/{uuid4()}")
    assert missing.status_code == 404


def test_register_artifact_schedules_download(client, fake_db, make_nlm, monkeypatch):
    # Background task runs after the response; stub it so no real work happens.
    called = {}

    async def fake_download(portal_id):
        called["portal_id"] = portal_id

    monkeypatch.setattr(
        "portal.backend.routers.artifacts.download_artifact_to_r2", fake_download
    )

    resp = client.post(
        "/api/artifacts",
        json={
            "nlm_artifact_id": "nlm-77",
            "notebook_id": "nb-1",
            "artifact_type": "report",
            "file_format": "md",
            "title": "Reg",
        },
    )
    assert resp.status_code == 201
    assert resp.json()["nlm_artifact_id"] == "nlm-77"
    assert "nlm_artifacts" in fake_db.store
    assert "portal_id" in called  # background task fired


def test_update_artifact_missing(client):
    resp = client.patch(f"/api/artifacts/{uuid4()}", json={"title": "x"})
    assert resp.status_code == 404


def test_delete_artifact(client, fake_db):
    row = _full_artifact_row()
    fake_db.seed("nlm_artifacts", [row])
    resp = client.delete(f"/api/artifacts/{row['id']}")
    assert resp.status_code == 204
    assert fake_db.store["nlm_artifacts"] == []


def test_delete_artifact_missing(client):
    resp = client.delete(f"/api/artifacts/{uuid4()}")
    assert resp.status_code == 404


def test_artifact_content_not_downloaded(client, fake_db):
    row = _full_artifact_row(r2_key=None)
    fake_db.seed("nlm_artifacts", [row])
    resp = client.get(f"/api/artifacts/{row['id']}/content")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Generate endpoint
# ---------------------------------------------------------------------------


def test_generate_unknown_type_returns_400(client):
    resp = client.post("/api/notebooks/nb-1/generate", json={"artifact_type": "bogus"})
    assert resp.status_code == 400
    assert "Unknown artifact_type" in resp.json()["detail"]


def test_generate_data_table_requires_description(client, fake_db, make_nlm):
    fake_db.seed("notebooks", [{"id": "nb-1", "title": "T"}])
    make_nlm(FakeArtifacts())
    resp = client.post(
        "/api/notebooks/nb-1/generate",
        json={"artifact_type": "data_table", "description": ""},
    )
    assert resp.status_code == 400
    assert "data_table requires a description" in resp.json()["detail"]


def test_generate_report_happy_path(client, fake_db, make_nlm, monkeypatch):
    fake_db.seed("notebooks", [{"id": "nb-1", "title": "My Notebook"}])
    make_nlm(FakeArtifacts(gen_status=_Status(task_id="task-9")))

    async def fake_generate_then_download(*a, **k):
        return None

    monkeypatch.setattr(
        "portal.backend.tasks.generator.generate_then_download",
        fake_generate_then_download,
    )

    resp = client.post(
        "/api/notebooks/nb-1/generate",
        json={"artifact_type": "report", "description": "My report", "language": "en"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["nlm_id"] == "task-9"
    assert body["artifact_type"] == "report"
    assert body["file_format"] == "md"
    assert body["download_status"] == "generating"
    assert body["portal_id"] is not None
    # A row was persisted in the generating state.
    assert fake_db.store["nlm_artifacts"][0]["nlm_artifact_id"] == "task-9"
