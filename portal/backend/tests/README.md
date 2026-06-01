# Portal backend tests

These tests are **isolated from the `notebooklm` library suite**. The root
`pyproject.toml` pins `testpaths = ["tests"]` and a 90%-coverage gate scoped to
`src/notebooklm`, so a bare `uv run pytest` never collects or counts these.

Run them explicitly:

```bash
uv run pytest portal/backend/tests
```

No real credentials are needed — `conftest.py` injects dummy settings and
in-memory fakes for Supabase, R2, and the NotebookLM client, so nothing touches
the network.

## Layout

| File | Phase | Covers |
|------|-------|--------|
| `test_pure_functions.py` | 1 | `_download_by_type` id-pinning, MIME/format maps, R2 key builders, `strip_reasoning`, `_nlm_lang` |
| `test_pipeline.py` | 2 | `download_artifact_to_r2` + `generate_then_download` state machine (happy / failure / timeout) |
| `test_api.py` | 3 | FastAPI router smoke tests (health, artifacts CRUD, generate endpoint) |
