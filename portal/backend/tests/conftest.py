"""Shared fixtures + in-memory fakes for the portal backend test suite.

These tests are intentionally isolated from the ``notebooklm`` library suite
(root ``pyproject.toml`` pins ``testpaths = ["tests"]`` and a 90% coverage gate
scoped to ``src/notebooklm``). Run them explicitly:

    uv run pytest portal/backend/tests
"""

from __future__ import annotations

import sys
from pathlib import Path
from uuid import uuid4

import pytest

# ``portal`` is a PEP-420 namespace package (no __init__.py), so put the repo
# root on sys.path and import everything as ``portal.backend.*``.
_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


@pytest.fixture(autouse=True)
def _dummy_settings(monkeypatch):
    """Inject dummy credentials so ``get_settings()`` never needs a real .env.

    pydantic env vars take precedence over the .env file, and the cached
    singletons are cleared so each test sees these values.
    """
    env = {
        "SUPABASE_URL": "https://dummy.supabase.co",
        "SUPABASE_ANON_KEY": "anon",
        "SUPABASE_SERVICE_ROLE_KEY": "service",
        "R2_ACCOUNT_ID": "acct",
        "R2_ACCESS_KEY_ID": "akid",
        "R2_SECRET_ACCESS_KEY": "secret",
        "R2_ENDPOINT_URL": "https://dummy.r2.cloudflarestorage.com",
        "R2_BUCKET_NAME": "test-bucket",
        "R2_PUBLIC_URL": "https://files.example.com",
        "ANTHROPIC_API_KEY": "",
        "GEMINI_API_KEY": "",
    }
    for k, v in env.items():
        monkeypatch.setenv(k, v)

    from portal.backend import config, database, storage

    # Capture the real lru_cache wrappers now — a test may monkeypatch these
    # names with plain lambdas (no .cache_clear), so clear via these refs.
    cached = (config.get_settings, database.get_supabase, storage.get_r2)
    for fn in cached:
        fn.cache_clear()
    yield
    for fn in cached:
        fn.cache_clear()


# ---------------------------------------------------------------------------
# Fake Supabase — a tiny in-memory stand-in for the fluent query builder
# ---------------------------------------------------------------------------


class _Result:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


class _Query:
    def __init__(self, store: dict, table: str):
        self._store = store
        self._table = table
        self._op = "select"
        self._payload = None
        self._on_conflict = None
        self._count = None
        self._filters: list[tuple] = []
        self._order = None
        self._range = None
        self._defaults: dict = {}

    # builder verbs -------------------------------------------------------
    def select(self, _cols="*", count=None):
        self._op, self._count = "select", count
        return self

    def insert(self, row):
        self._op, self._payload = "insert", row
        return self

    def upsert(self, row, on_conflict=None):
        self._op, self._payload, self._on_conflict = "upsert", row, on_conflict
        return self

    def update(self, patch):
        self._op, self._payload = "update", patch
        return self

    def delete(self):
        self._op = "delete"
        return self

    def eq(self, field, value):
        self._filters.append(("eq", field, value))
        return self

    def contains(self, field, value):
        self._filters.append(("contains", field, value))
        return self

    def ilike(self, field, value):
        self._filters.append(("ilike", field, value))
        return self

    def order(self, field, desc=False):
        self._order = (field, desc)
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    # execution -----------------------------------------------------------
    def _match(self, row) -> bool:
        for kind, field, value in self._filters:
            if kind == "eq" and row.get(field) != value:
                return False
            if kind == "contains":
                col = row.get(field) or []
                if not all(v in col for v in value):
                    return False
            if kind == "ilike":
                needle = value.strip("%").lower()
                if needle not in str(row.get(field, "")).lower():
                    return False
        return True

    def execute(self) -> _Result:
        rows = self._store.setdefault(self._table, [])

        if self._op == "select":
            matched = [dict(r) for r in rows if self._match(r)]
            total = len(matched)
            if self._order:
                f, desc = self._order
                matched.sort(key=lambda r: (r.get(f) is None, r.get(f)), reverse=desc)
            if self._range:
                s, e = self._range
                matched = matched[s : e + 1]
            return _Result(matched, total if self._count == "exact" else None)

        if self._op == "insert":
            items = self._payload if isinstance(self._payload, list) else [self._payload]
            out = []
            for it in items:
                r = {**self._defaults, **it}
                r.setdefault("id", str(uuid4()))
                rows.append(r)
                out.append(dict(r))
            return _Result(out)

        if self._op == "upsert":
            items = self._payload if isinstance(self._payload, list) else [self._payload]
            out, key = [], self._on_conflict
            for it in items:
                r = {**self._defaults, **it}
                existing = None
                if key and key in r:
                    existing = next((ex for ex in rows if ex.get(key) == r[key]), None)
                if existing:
                    existing.update(r)
                    existing.setdefault("id", str(uuid4()))
                    out.append(dict(existing))
                else:
                    r.setdefault("id", str(uuid4()))
                    rows.append(r)
                    out.append(dict(r))
            return _Result(out)

        if self._op == "update":
            updated = []
            for r in rows:
                if self._match(r):
                    r.update(self._payload)
                    updated.append(dict(r))
            return _Result(updated)

        if self._op == "delete":
            removed = [dict(r) for r in rows if self._match(r)]
            self._store[self._table] = [r for r in rows if not self._match(r)]
            return _Result(removed)

        return _Result([])


class FakeSupabase:
    def __init__(self, store: dict | None = None):
        self.store: dict[str, list[dict]] = store if store is not None else {}
        # Per-table column defaults, applied on insert/upsert to mimic the
        # NOT NULL / DEFAULT columns the real Postgres table fills in.
        self.defaults: dict[str, dict] = {}

    def table(self, name: str) -> _Query:
        q = _Query(self.store, name)
        q._defaults = self.defaults.get(name, {})
        return q

    def seed(self, table: str, rows: list[dict]) -> None:
        self.store.setdefault(table, []).extend(dict(r) for r in rows)


@pytest.fixture
def fake_db() -> FakeSupabase:
    return FakeSupabase()


# ---------------------------------------------------------------------------
# Fake NotebookLM client
# ---------------------------------------------------------------------------


class _Status:
    """Stand-in for GenerationStatus returned by generate_* / wait_for_completion."""

    def __init__(self, *, task_id="task-1", is_failed=False, error=None):
        self.task_id = task_id
        self.is_failed = is_failed
        self.error = error


class _Artifact:
    def __init__(self, *, id="task-1", title="Generated", is_completed=True):
        self.id = id
        self.title = title
        self.is_completed = is_completed


class FakeArtifacts:
    """Records every call; download_* writes bytes so the downloader can read them."""

    def __init__(
        self,
        *,
        download_writes=b"FILE-BYTES",
        wait_result=None,
        wait_exc=None,
        get_artifact=None,
        gen_status=None,
        gen_exc=None,
    ):
        self.calls: list[tuple] = []
        self._download_writes = download_writes
        self._wait_result = wait_result if wait_result is not None else _Status()
        self._wait_exc = wait_exc
        self._get_artifact = get_artifact
        self._gen_status = gen_status if gen_status is not None else _Status()
        self._gen_exc = gen_exc

    async def wait_for_completion(self, notebook_id, task_id, timeout=None):
        self.calls.append(("wait", notebook_id, task_id, timeout))
        if self._wait_exc:
            raise self._wait_exc
        return self._wait_result

    async def get(self, notebook_id, task_id):
        self.calls.append(("get", notebook_id, task_id))
        return self._get_artifact

    async def _download(self, name, notebook_id, out_path, artifact_id, output_format=None):
        self.calls.append((name, notebook_id, out_path, artifact_id, output_format))
        Path(out_path).write_bytes(self._download_writes)
        return out_path

    async def download_audio(self, notebook_id, out_path, artifact_id=None):
        return await self._download("download_audio", notebook_id, out_path, artifact_id)

    async def download_video(self, notebook_id, out_path, artifact_id=None):
        return await self._download("download_video", notebook_id, out_path, artifact_id)

    async def download_report(self, notebook_id, out_path, artifact_id=None):
        return await self._download("download_report", notebook_id, out_path, artifact_id)

    async def download_infographic(self, notebook_id, out_path, artifact_id=None):
        return await self._download("download_infographic", notebook_id, out_path, artifact_id)

    async def download_data_table(self, notebook_id, out_path, artifact_id=None):
        return await self._download("download_data_table", notebook_id, out_path, artifact_id)

    async def download_mind_map(self, notebook_id, out_path, artifact_id=None):
        return await self._download("download_mind_map", notebook_id, out_path, artifact_id)

    async def download_quiz(self, notebook_id, out_path, artifact_id=None, output_format="json"):
        return await self._download("download_quiz", notebook_id, out_path, artifact_id, output_format)

    async def download_flashcards(
        self, notebook_id, out_path, artifact_id=None, output_format="json"
    ):
        return await self._download(
            "download_flashcards", notebook_id, out_path, artifact_id, output_format
        )

    async def download_slide_deck(
        self, notebook_id, out_path, artifact_id=None, output_format="pdf"
    ):
        return await self._download(
            "download_slide_deck", notebook_id, out_path, artifact_id, output_format
        )

    async def _generate(self, name, *args, **kwargs):
        self.calls.append((name, args, kwargs))
        if self._gen_exc:
            raise self._gen_exc
        return self._gen_status

    def __getattr__(self, name):
        # Any generate_* method records its call and returns the canned status.
        if name.startswith("generate_"):
            async def _gen(*args, **kwargs):
                return await self._generate(name, *args, **kwargs)

            return _gen
        raise AttributeError(name)


class FakeNLMClient:
    """Async-context-manager stand-in for NotebookLMClient."""

    last_instance: "FakeNLMClient | None" = None

    def __init__(self, artifacts: FakeArtifacts):
        self.artifacts = artifacts

    @classmethod
    def with_artifacts(cls, artifacts: FakeArtifacts):
        async def _from_storage():
            inst = cls(artifacts)
            FakeNLMClient.last_instance = inst
            return inst

        # Mimic NotebookLMClient.from_storage() — an awaitable classmethod.
        cls.from_storage = staticmethod(_from_storage)
        return cls

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


@pytest.fixture
def make_nlm(monkeypatch):
    """Patch ``notebooklm.NotebookLMClient`` with a fake bound to given artifacts."""

    def _factory(artifacts: FakeArtifacts):
        import notebooklm

        fake_cls = FakeNLMClient.with_artifacts(artifacts)
        monkeypatch.setattr(notebooklm, "NotebookLMClient", fake_cls)
        return fake_cls

    return _factory
