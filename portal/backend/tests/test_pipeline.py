"""Phase 2 — background-pipeline tests (downloader + generator state machine)."""

from __future__ import annotations

from uuid import uuid4

import pytest

from portal.backend.tasks.downloader import download_artifact_to_r2
from portal.backend.tasks.generator import generate_then_download
from portal.backend.tests.conftest import FakeArtifacts, _Artifact, _Status


def _seed_artifact(fake_db, **overrides):
    pid = str(uuid4())
    row = {
        "id": pid,
        "notebook_id": "nb-1",
        "artifact_type": "report",
        "nlm_artifact_id": "task-1",
        "file_format": "md",
        "title": "Old title",
        "download_status": "generating",
    }
    row.update(overrides)
    fake_db.seed("nlm_artifacts", [row])
    return pid


# ---------------------------------------------------------------------------
# download_artifact_to_r2
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_download_to_r2_happy_path(monkeypatch, fake_db, make_nlm):
    pid = _seed_artifact(fake_db)
    artifacts = FakeArtifacts(download_writes=b"hello-report")
    make_nlm(artifacts)

    uploaded = {}

    def fake_upload(key, data, mime):
        uploaded.update(key=key, data=data, mime=mime)
        return f"https://files.example.com/{key}"

    monkeypatch.setattr("portal.backend.database.get_supabase", lambda: fake_db)
    monkeypatch.setattr("portal.backend.storage.upload_file", fake_upload)

    from uuid import UUID

    await download_artifact_to_r2(UUID(pid))

    # The download was pinned to the stored NLM artifact id.
    dl = next(c for c in artifacts.calls if c[0] == "download_report")
    assert dl[3] == "task-1"

    # R2 received the right key + bytes.
    assert uploaded["key"] == "notebooklm/nb-1/report/task-1.md"
    assert uploaded["data"] == b"hello-report"

    # Row flipped to done with size + url recorded.
    row = fake_db.store["nlm_artifacts"][0]
    assert row["download_status"] == "done"
    assert row["r2_key"] == "notebooklm/nb-1/report/task-1.md"
    assert row["r2_url"].endswith("task-1.md")
    assert row["file_size_bytes"] == len(b"hello-report")


@pytest.mark.asyncio
async def test_download_to_r2_failure_marks_failed(monkeypatch, fake_db, make_nlm):
    pid = _seed_artifact(fake_db)
    make_nlm(FakeArtifacts())

    def boom(*a, **k):
        raise RuntimeError("R2 down")

    monkeypatch.setattr("portal.backend.database.get_supabase", lambda: fake_db)
    monkeypatch.setattr("portal.backend.storage.upload_file", boom)

    from uuid import UUID

    await download_artifact_to_r2(UUID(pid))  # must not raise

    row = fake_db.store["nlm_artifacts"][0]
    assert row["download_status"] == "failed"
    assert "R2 down" in row["download_error"]


@pytest.mark.asyncio
async def test_download_to_r2_missing_row_is_noop(monkeypatch, fake_db, make_nlm):
    make_nlm(FakeArtifacts())
    monkeypatch.setattr("portal.backend.database.get_supabase", lambda: fake_db)

    from uuid import UUID

    await download_artifact_to_r2(UUID(str(uuid4())))  # unknown id

    assert fake_db.store.get("nlm_artifacts", []) == []


# ---------------------------------------------------------------------------
# generate_then_download — state machine
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_then_download_happy_path(monkeypatch, fake_db, make_nlm):
    pid = _seed_artifact(fake_db)
    artifacts = FakeArtifacts(
        wait_result=_Status(is_failed=False),
        get_artifact=_Artifact(title="Refreshed Title"),
    )
    make_nlm(artifacts)
    monkeypatch.setattr("portal.backend.database.get_supabase", lambda: fake_db)

    called = {}

    async def fake_download(portal_id):
        called["portal_id"] = portal_id

    monkeypatch.setattr(
        "portal.backend.tasks.downloader.download_artifact_to_r2", fake_download
    )

    from uuid import UUID

    await generate_then_download("nb-1", "task-1", UUID(pid), "report")

    row = fake_db.store["nlm_artifacts"][0]
    # Title refreshed from NLM, then handed to the download phase as 'pending'.
    assert row["title"] == "Refreshed Title"
    assert row["download_status"] == "pending"
    assert called["portal_id"] == UUID(pid)


@pytest.mark.asyncio
async def test_generate_then_download_timeout(monkeypatch, fake_db, make_nlm):
    pid = _seed_artifact(fake_db)
    make_nlm(FakeArtifacts(wait_exc=TimeoutError("slow")))
    monkeypatch.setattr("portal.backend.database.get_supabase", lambda: fake_db)

    downloaded = {}

    async def fake_download(portal_id):
        downloaded["hit"] = True

    monkeypatch.setattr(
        "portal.backend.tasks.downloader.download_artifact_to_r2", fake_download
    )

    from uuid import UUID

    await generate_then_download("nb-1", "task-1", UUID(pid), "report")

    row = fake_db.store["nlm_artifacts"][0]
    assert row["download_status"] == "failed"
    assert "timed out" in row["download_error"]
    assert "hit" not in downloaded  # never reached the download phase


@pytest.mark.asyncio
async def test_generate_then_download_nlm_reports_failure(monkeypatch, fake_db, make_nlm):
    pid = _seed_artifact(fake_db)
    make_nlm(FakeArtifacts(wait_result=_Status(is_failed=True, error="model refused")))
    monkeypatch.setattr("portal.backend.database.get_supabase", lambda: fake_db)

    from uuid import UUID

    await generate_then_download("nb-1", "task-1", UUID(pid), "report")

    row = fake_db.store["nlm_artifacts"][0]
    assert row["download_status"] == "failed"
    assert row["download_error"] == "model refused"


@pytest.mark.asyncio
async def test_generate_then_download_wait_error(monkeypatch, fake_db, make_nlm):
    pid = _seed_artifact(fake_db)
    make_nlm(FakeArtifacts(wait_exc=RuntimeError("connection reset")))
    monkeypatch.setattr("portal.backend.database.get_supabase", lambda: fake_db)

    from uuid import UUID

    await generate_then_download("nb-1", "task-1", UUID(pid), "report")

    row = fake_db.store["nlm_artifacts"][0]
    assert row["download_status"] == "failed"
    assert "connection reset" in row["download_error"]
