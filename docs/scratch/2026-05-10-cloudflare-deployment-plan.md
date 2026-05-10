# Cloudflare Deployment Plan — research-corpus portal

**Date:** 2026-05-10
**Status:** Draft for review
**Author:** Claude (working with Mike)

## Goal

Ship the portal so users other than Mike can run it without a local dev environment. Stretch goal: do it on Cloudflare end-to-end (Pages + Workers + R2) since R2 is already wired in.

## Current architecture

| Component | Tech | Location | Notes |
|-----------|------|----------|-------|
| Frontend | Next.js 16 (App Router, RSC) | `portal/frontend/` | `npm run dev` on port 3000 |
| Backend | FastAPI + Python 3.12 | `portal/backend/` | uvicorn at `127.0.0.1:8000` |
| Core engine | `notebooklm-py` | `src/notebooklm/` | Library that talks to NotebookLM RPCs |
| Database | Supabase Postgres | cloud (`llusronucprogsrgzxrw.supabase.co`) | already cloud-hosted |
| Object storage | Cloudflare R2 | cloud | already cloud-hosted |
| Auth tokens | local file `~/.notebooklm/auth.json` | per-machine | single user, captured via Playwright |

## Hard constraints

These are the reasons "everything on Cloudflare Workers" doesn't work directly:

1. **Workers don't run Python natively.** `notebooklm-py` uses `httpx` (native deps), and Workers Python (Pyodide) is beta with no native-extension support.
2. **Login flow uses Playwright.** Workers can't drive a real browser. Every NotebookLM session needs cookies that Google issues only after a Playwright-driven sign-in. There is no public OAuth path.
3. **Long-running requests.** Chat = 30–60 s, research import = 30–90 s, deep research = up to 5 min. Workers free tier has a 30 s CPU limit; paid tier has 5 min wall time but 30 s CPU. Cutting close to limits.
4. **Multi-tenancy is not built.** The backend assumes a single global auth token. Shipping to N users requires:
   - Per-user accounts and authentication
   - Per-user NotebookLM cookies stored server-side
   - Row-level security on the Supabase tables (`notebooks`, `nlm_artifacts`, `library_items`)
   - A way to bootstrap each user's NotebookLM session (the hard part — see Phase 3)

## Target architecture

```
   ┌─────────────────────────┐
   │   Cloudflare Pages      │  ← Next.js frontend (static + edge)
   │   notebooklm.pages.dev  │
   └────────────┬────────────┘
                │ /api/* via Pages rewrite to a public BACKEND_URL
                ▼
   ┌─────────────────────────┐
   │   Fly.io (or Railway)   │  ← FastAPI + notebooklm-py + Playwright Chromium
   │   1 always-on VM        │     mounted volume for /data/notebooklm
   └────────────┬────────────┘
                │
        ┌───────┼────────┐
        ▼       ▼        ▼
   Supabase   R2     NotebookLM (Google)
```

Why a VM and not Workers for the backend:

- It runs Python, including native deps (httpx, asyncpg, Playwright).
- It can hold a long-running `httpx.AsyncClient` session with cookie state.
- It can install Chromium for the rare case we need to refresh login.
- A `shared-cpu-1x` Fly machine with 512 MB is ~$2/month idle.

R2 stays as-is (already used). Supabase stays as-is (already used). Only the frontend and backend change *deployment targets*.

## Phases

Each phase is a separate PR / shippable milestone. After each phase the project is more deployable but still works.

### Phase 1 — Frontend on Cloudflare Pages

**Effort:** ~1 day · **Risk:** low · **Outcome:** anyone with the URL can load the UI; backend still on Mike's laptop or a tunnel.

Tasks:

1. Add `@cloudflare/next-on-pages` adapter (or use Cloudflare's built-in Next.js support since v3).
2. Add `wrangler.toml` with `pages_build_output_dir = ".vercel/output/static"`.
3. Set `BACKEND_URL` in Pages environment to whatever public URL the backend is at (initially a `cloudflared` tunnel from Mike's laptop, later the Fly.io URL).
4. Configure `next.config.ts` rewrites to use `process.env.BACKEND_URL`.
5. Add a GitHub Action: on push to `main`, run `wrangler pages deploy`.
6. Test: open the `.pages.dev` URL on a phone, confirm the landing page loads and `/api/notebooks` proxies through.

Open questions:

- Does Cloudflare's Next.js compat handle our experimental flags (`proxyTimeout`)? — likely yes, it's a server-side concern.
- Do we want a custom domain? (`portal.<your-domain>`)

### Phase 2 — Backend on Fly.io with Docker

**Effort:** ~1–2 days · **Risk:** medium · **Outcome:** portal runs without Mike's laptop.

Tasks:

1. New `portal/backend/Dockerfile`:
   - Base: `python:3.12-slim`
   - Install: `uv`, system deps for Playwright Chromium, our project deps via `uv sync`
   - Run: `uvicorn portal.backend.main:app --host 0.0.0.0 --port 8080`
2. New `fly.toml`:
   - 1 machine, `shared-cpu-1x`, 512 MB RAM
   - 1 GB persistent volume mounted at `/data/notebooklm` for auth tokens
   - Health check on `/api/notebooks`
   - Auto-stop disabled (we want it warm so chat is fast)
3. Migration: change `notebooklm-py` storage path to honour `NOTEBOOKLM_HOME=/data/notebooklm` (already supported per `paths.py`).
4. Bootstrap: `fly ssh console` once, run `notebooklm login` to capture cookies into the volume. Document this step.
5. Set Fly secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `R2_*`, `BACKEND_PORT=8080`.
6. Update Pages `BACKEND_URL` to the Fly URL.
7. Test: chat, generate, download, discover all work end-to-end with the laptop closed.

Open questions:

- Should we keep auth tokens on a Fly volume or move them to Supabase (encrypted)? Volume is simpler for Phase 2; Supabase makes Phase 3 easier.
- Do we want Cloudflare Access in front of the Fly URL for now (so only logged-in users can hit the API)?

### Phase 3 — Multi-tenancy

**Effort:** ~1 week · **Risk:** high (auth UX is hostile) · **Outcome:** real users can sign up and use their own notebooks.

This is where the project goes from "deployed for Mike" to "deployed for everyone." Three sub-problems, each needs a decision.

#### 3a. User accounts

- Use **Supabase Auth** (email + Google OAuth). It's already in the project; adding sign-up takes a day.
- Add `owner_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE` to: `notebooks`, `nlm_artifacts`, `library_items`.
- Turn on RLS with policy `auth.uid() = owner_user_id` on each table.
- Frontend: gate the `/notebooklm` and `/library` pages behind a sign-in.

#### 3b. Per-user NotebookLM session

This is the hard part. Each user needs their own Google cookies stored on our backend. Options:

| Option | UX | Implementation effort | Reliability |
|--------|-----|----------------------|-------------|
| (i) Browser extension | Best — click "Connect", extension grabs cookies, POSTs them | 2–3 days | High — same flow Google expects |
| (ii) Paste-cookie wizard | Bad — user opens DevTools, copies 3 cookies, pastes into a form | 0.5 day | Medium — users mis-copy |
| (iii) Local CLI + upload | OK for power users only | 0 days (already works) | High |
| (iv) "Magic" QR code that opens Google login | Doesn't exist; Google blocks Playwright on serverless | N/A | N/A |

Recommendation: ship (ii) and (iii) in Phase 3 since they need no extra code. Build (i) as a Phase 4 polish if the project gets traction.

New table:

```sql
CREATE TABLE user_secrets (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  notebooklm_auth jsonb NOT NULL,  -- the auth.json blob, encrypted at rest
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_secrets ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_secrets_owner ON user_secrets
  FOR ALL TO authenticated USING (auth.uid() = user_id);
```

Encryption: use `pgcrypto` or a Cloudflare KV-stored master key. Decision needed.

#### 3c. Backend session loading

Today: `NotebookLMClient.from_storage()` reads `~/.notebooklm/auth.json`.

Multi-user version: a thin wrapper that takes `user_id`, fetches their `user_secrets` row, writes it to a temp file (or in-memory), then calls `from_storage(storage_path=...)`.

This means every API endpoint needs to know "who is calling." We add a FastAPI dependency that reads the Supabase JWT from the `Authorization` header and extracts `user_id`. All existing endpoints get a `user: User = Depends(get_current_user)` parameter.

This is a big diff — every endpoint in `routers/notebooks.py` and `routers/artifacts.py`. Estimate ~half a day for the mechanical change plus a day for thorough testing.

### Phase 4 — Cloudflare-native polish (optional)

After Phase 3 ships, these are nice-to-haves that lean on Cloudflare's edge.

- **Worker in front of the Fly backend** for:
  - Per-user rate limiting (Workers KV counters)
  - Edge caching of `GET /notebooks` and `GET /description` — these are read-heavy and rarely change
  - Request logging into Cloudflare Logpush or Workers Analytics
- **Cloudflare Access** in front of admin pages (sync logs, internal dashboards)
- **R2 signed URLs** instead of streaming through the backend — frontend gets a presigned URL, downloads directly from R2. Saves backend bandwidth.
- **Durable Objects** for chat sessions if we want true streaming responses (Server-Sent Events from Worker → browser).

## Costs (estimate at low scale)

| Service | Free tier | Paid (low scale) |
|---------|-----------|------------------|
| Cloudflare Pages | unlimited bandwidth, 100 builds/mo | $20/mo Pro if needed |
| Cloudflare R2 | 10 GB storage, 1M class A ops/mo | $0.015/GB-month over 10 GB |
| Cloudflare Workers (Phase 4) | 100k requests/day | $5/mo + $0.50/M requests |
| Fly.io | 3 shared-cpu-1x VMs free | ~$2/mo when over the free allowance |
| Supabase | 500 MB DB, 2 GB egress | $25/mo Pro tier when DB > 500 MB |
| **Total at <100 users** | mostly free tier | **~$5–10/month** |

## Multi-user implications NOT in scope of this plan

These would all become issues if the project gets significant adoption — flagging now so we don't get surprised:

- **Google rate limits NotebookLM per-account.** If many users do heavy work, individual accounts get throttled. Not our problem — it's user-by-user.
- **NotebookLM auth tokens expire.** Backend already has refresh logic; verify it works in the multi-user path.
- **Storage abuse.** R2 is per-bucket; one user could fill it. Need a per-user quota in Phase 4.
- **GDPR / data deletion.** Need a "delete my account" flow that nukes the user's notebooks + artifacts + R2 files + auth tokens. Cascading FKs make most of this automatic.
- **Trademark / ToS.** "Unofficial NotebookLM client" — Google may not love this being public. Consider naming the deployed product something neutral.

## Recommendation

Ship in this order:

1. **Phase 1** (Pages, ~1 day) — biggest UX win for cost; we get a public URL even with zero backend changes.
2. **Phase 2** (Fly, ~1–2 days) — moves the backend off Mike's laptop. After this, we have a working single-user product anyone with the URL can use IF they trust Mike's auth tokens (they don't — but the URL works).
3. **Phase 3** (multi-tenancy, ~1 week) — needed before sharing the URL with anyone who isn't Mike. Schema changes + auth UX = the riskiest piece.
4. **Phase 4** (Cloudflare polish, optional) — only worth it once Phase 3 is stable and we have real usage to optimize.

**Decision points before starting any of this:**

- Are we OK with Fly.io as the backend host, or do you want me to evaluate Railway / Render / DigitalOcean droplet?
- Phase 3: which of (i) browser extension, (ii) paste-cookie, (iii) CLI upload do you want to build first? My recommendation: ship (iii) for our own use first (it's already implemented), then build (i) for real users since (ii) is a UX disaster.
- Phase 3: comfortable with Supabase Auth, or want to use Clerk / Auth0 / Cloudflare Access for sign-in instead?

## Files this plan would touch

For reference when estimating scope:

- New: `portal/backend/Dockerfile`, `fly.toml`, `wrangler.toml`, `.github/workflows/deploy.yml`
- Modified: `portal/frontend/next.config.ts` (BACKEND_URL env), `portal/backend/database.py` (per-user supabase client), every router (add user dependency)
- New SQL migrations: `004_owner_user_id.sql`, `005_user_secrets.sql`, `006_rls_policies.sql`
- New frontend pages: `/login`, `/connect-notebooklm`
