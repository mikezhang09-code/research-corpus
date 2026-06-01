# Codespaces Review Findings

Date: 2026-05-31

## Summary

Reviewed the recent committed portal changes on `main`, focused on artifact generation, quiz/flashcard viewing, language handling, and frontend/public build health.

## Status (updated 2026-06-01 after re-review)

| Finding | Verdict after re-review | Action |
|---|---|---|
| 1 — wrong artifact downloaded | Valid bug; fix confirmed safe | **Fixed** |
| 2 — global language leak | Valid, but lower impact and the proposed fix has a timing risk | **Not fixed — needs e2e verification first** |
| 3 — eslint `.open-next` | Cosmetic; rationale inaccurate; no CI impact | **Not fixed — optional tidy-up** |

## Findings

### High: Artifact downloads can save the wrong NotebookLM artifact

`portal/backend/tasks/downloader.py` reads `nlm_artifact_id` from the database row, but `_download_by_type(...)` does not receive or pass that ID into the NotebookLM download calls.

For quiz and flashcards, the client library falls back to the latest completed artifact when `artifact_id` is omitted. If multiple artifacts are generated close together, the portal row can upload content from a different completed artifact to R2.

Affected path:

- `portal/backend/tasks/downloader.py`

Suggested fix:

- Pass `nlm_artifact_id` into `_download_by_type`.
- For supported artifact types, call downloads with `artifact_id=nlm_artifact_id`.
- At minimum, fix quiz and flashcards because those are newly interactive and especially likely to be confused by “latest completed” fallback behavior.

**Status: FIXED.** `_download_by_type` now receives `nlm_artifact_id` and forwards
`artifact_id=...` to every `download_*` call, so downloads are pinned to the exact
artifact instead of the client's "latest completed of this type" fallback
(`_artifact_downloads.py` selects `completed[0]` when `artifact_id` is omitted).

Verified safe: the stored `nlm_artifact_id` is the generation `task_id`
(`routers/notebooks.py`), and `task_id` is the artifact `.id` — the generator already
round-trips it through `client.artifacts.get(...)` / `wait_for_completion(...)`, both of
which match on `a.id`. So passing it as `artifact_id` resolves correctly for all types.

### Medium: Quiz and flashcard generation changes global NotebookLM language state

`portal/backend/routers/notebooks.py` sets NotebookLM account-wide output language before generating quizzes and flashcards, because those RPCs do not expose a per-artifact language parameter.

That language setting is global account state and is not restored afterward. A portal request can silently affect later NotebookLM artifact generation outside this request.

Affected path:

- `portal/backend/routers/notebooks.py`

Suggested fix:

- Read the previous language with `client.settings.get_output_language()`.
- Set the requested language only for the generation call.
- Restore the previous language in a `finally` block.
- Consider serialization or documenting residual race risk if concurrent quiz/flashcard generations use different languages.

**Status: NOT FIXED — intentionally deferred.**

Reasons:

1. **The proposed fix is not unconditionally safe.** Generation is asynchronous:
   `generate_quiz` / `generate_flashcards` return a `task_id` immediately and the
   artifact is built later in the `generate_then_download` background task. If
   NotebookLM reads the account-wide output language at *task-execution* time rather
   than at the generate-RPC call, restoring the language in a `finally` block right
   after the call returns would revert it **before** the artifact is generated and
   produce wrong-language output — worse than the current leak. The restore is only
   correct if NLM binds the language at enqueue time. This needs an e2e check
   (set language → generate → restore immediately → confirm output language) against
   a live authenticated NLM session, which is not available in this review env.

2. **Lower real-world impact than stated.** Every other artifact type passes
   `language=language` explicitly (audio, video, report, slide_deck, infographic,
   data_table), and quiz/flashcards always set the language immediately before
   generating. So inside the portal the global state is self-correcting; the leak
   only affects the NotebookLM web UI / other external tools on the same account.
   For a single-user portal this is a hygiene issue, not a functional bug.

Action: leave as-is until the enqueue-vs-execution timing is verified, then add the
save/restore (or a background-task restore after `wait_for_completion`).

### Medium: Public lint fails after build because generated `.open-next` output is linted

`portal/public/eslint.config.mjs` ignores `.next`, `out`, and `build`, but not `.open-next`. Running `npm run build` in `portal/public` creates `.open-next`; running `npm run lint` afterward lints generated output and emits thousands of errors/warnings.

Affected path:

- `portal/public/eslint.config.mjs`

Suggested fix:

- Add `.open-next/**` to `globalIgnores`.

**Status: NOT FIXED — optional cosmetic tidy-up. Rationale in the original finding
is inaccurate.**

Corrections:

- `npm run build` is `next build`, which produces `.next`, **not** `.open-next`.
  `.open-next` is produced only by the `opennextjs-cloudflare build` step inside
  `npm run preview` / `npm run deploy`.
- `.open-next` is already gitignored (`/.open-next/`), and **no CI workflow lints the
  public viewer** — `deploy-public-viewer.yml` only runs `npm run deploy`; `test.yml`
  / `codeql.yml` do not lint it. So there is zero CI impact.

Net: adding `.open-next/**` to `globalIgnores` is harmless and tidy, but this is a
**Low** local-dev nit (lint noise only if you run `npm run lint` after an opennext
build), not a Medium issue. Deferred.

## Verification

Commands run:

```bash
npm run build
```

Results:

- `portal/frontend`: passed.
- `portal/public`: passed.

```bash
npm run lint
```

Results:

- `portal/frontend`: failed with React hook/compiler lint errors already present in app source.
- `portal/public`: failed, heavily due to generated `.open-next` output after build.

