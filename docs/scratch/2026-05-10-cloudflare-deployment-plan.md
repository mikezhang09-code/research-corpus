# Cloudflare Deployment Plan — research-corpus portal

**Date:** 2026-05-10 (rescoped 2026-05-11)
**Status:** Draft for review
**Scope:** Personal-use only — single user (Mike). No multi-tenancy. No domain required.

## Goal

Use the portal from any device, any network, without keeping the laptop open or messing with port forwarding. Backend stays on the Oracle ARM VM; only the frontend moves to Cloudflare.

## Final architecture

```
   Browser anywhere
         │
         ▼
   ┌─────────────────────────┐
   │  Cloudflare Pages       │   Next.js frontend (free, global CDN)
   │  <app>.pages.dev        │
   └──────────┬──────────────┘
              │ /api/* via Next.js rewrites → BACKEND_URL
              ▼
   ┌─────────────────────────┐
   │  Cloudflare Tunnel      │   Public URL → VM. No port forward,
   │  *.trycloudflare.com    │   no static IP, no router config.
   └──────────┬──────────────┘
              │
              ▼
   Oracle ARM VM, FastAPI at 127.0.0.1:8000
   (start-backend.sh as today, plus a systemd unit for cloudflared)
```

Cost: **$0** (or $10/yr if you decide you want a stable hostname later — see Phase 1).

## What's not in scope

The previous draft of this plan included multi-tenancy, Fly.io migration,
and a 1-week Phase 3. **All cut**, because:

- It's just for Mike — no user accounts needed
- The backend runs fine on the Oracle VM — no reason to migrate it
- Cloudflare Access / Supabase Auth complicate everything for zero gain in a single-user product

## Phase 1 — Cloudflare Tunnel on the VM

**Effort:** ~30 minutes · **Cost:** $0 (free) or $10/yr (stable hostname)

### 1a. Free path — Quick Tunnel

```bash
# install on the Oracle ARM VM
sudo apt install cloudflared

# expose the local backend
cloudflared tunnel --url http://127.0.0.1:8000
```

You get a public URL like `https://<random-words>.trycloudflare.com`.

**Drawback:** the URL rotates whenever `cloudflared` restarts. To minimize
that:

```bash
# Run as a systemd service so it stays up across reboots
sudo cloudflared service install
```

Each rotation requires updating one Pages env var. In practice if the
service is persistent and the VM is stable (Oracle Always Free is), the
URL might last weeks at a time.

### 1b. Stable path — Named Tunnel + cheap domain (~$10/yr)

Skip unless 1a's URL rotation becomes annoying.

1. Buy a `.com` (~$9.15/yr) or `.xyz` (~$2/yr) at Cloudflare Registrar.
   Sold at cost — no markup.
2. The domain auto-registers as a Cloudflare zone.
3. Create a named tunnel:

   ```bash
   cloudflared tunnel login
   cloudflared tunnel create research-corpus
   cloudflared tunnel route dns research-corpus backend.<yourdomain>.com
   ```

4. Run it via systemd, persistent URL forever.

### Open questions

- Are you OK starting with 1a (free, rotating URL) and upgrading later
  only if it bites? My recommendation: yes.

## Phase 2 — Frontend on Cloudflare Pages

**Effort:** ~1 hour (mostly waiting for builds) · **Cost:** $0

### 2a. Add the Next.js adapter

```bash
cd portal/frontend
npm install --save-dev @cloudflare/next-on-pages
```

### 2b. Add `wrangler.toml` to `portal/frontend/`

```toml
name = "research-corpus-portal"
compatibility_date = "2025-04-01"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = ".vercel/output/static"
```

### 2c. Verify the existing `next.config.ts` honors `BACKEND_URL`

It already does (line 12):
```ts
const backendUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";
```

So locally it stays at `127.0.0.1:8000`; in production Pages provides
the tunnel URL. No code change needed.

### 2d. Connect repo to Cloudflare Pages

1. Cloudflare dashboard → Pages → "Connect to Git"
2. Pick `mikezhang09-code/research-corpus`
3. Set build output: `portal/frontend`
4. Build command: `npx @cloudflare/next-on-pages`
5. Set env var `BACKEND_URL` = the tunnel URL from Phase 1
6. Set env var `PORTAL_TOKEN` = a random 32-char string (see Phase 3)
7. Deploy

You get `<app>.pages.dev`. Bookmark it.

### Open questions

- Is `portal/frontend` the right Pages project root, or should we add a
  `portal/frontend/.cloudflare/` config dir to keep wrangler files
  contained?
- Auto-deploy on every push to `main`, or only on a `release` branch?

## Phase 3 — Single-secret authentication

**Effort:** ~30 minutes · **Cost:** $0

The Pages frontend is public, the tunnel URL is effectively public. Without
auth, anyone who finds either URL can hit the backend with Mike's
NotebookLM session. We don't need real user accounts — just keep
randos out.

### 3a. Backend middleware

`portal/backend/main.py`:

```python
import os, secrets
from fastapi import Request, HTTPException

PORTAL_TOKEN = os.environ.get("PORTAL_TOKEN")

@app.middleware("http")
async def require_token(request: Request, call_next):
    # Allow health checks and the docs page without auth
    if request.url.path in ("/", "/docs", "/openapi.json"):
        return await call_next(request)
    if not PORTAL_TOKEN:
        return await call_next(request)  # dev mode — no token configured
    supplied = request.headers.get("X-Portal-Token", "")
    if not secrets.compare_digest(supplied, PORTAL_TOKEN):
        raise HTTPException(401, "Unauthorized")
    return await call_next(request)
```

Set `PORTAL_TOKEN` in `portal/.env` to a 32-char random string:

```bash
openssl rand -hex 16
```

### 3b. Frontend injects the token

`portal/frontend/src/lib/api.ts` — the `request()` helper currently does:

```ts
const res = await fetch(`${BASE}${path}`, {
  headers: { "Content-Type": "application/json", ...init?.headers },
  ...init,
});
```

Change to read `process.env.NEXT_PUBLIC_PORTAL_TOKEN` and add it to every
request. Wait — `NEXT_PUBLIC_*` is exposed to the browser, which means
anyone who views source can read the token. **That's fine for our threat
model** (Mike's only sharing the URL with himself; the token just stops
random crawlers and bots scanning for open APIs).

Actually a cleaner option: have Next.js inject the token server-side via
a rewrite-with-header. Cloudflare Pages' rewrites support adding headers.
Then the token never reaches the browser. Decision for the implementation.

### 3c. Local dev still works

Skip the token when running locally:
- Locally, `BACKEND_URL` is empty → Next.js proxies via rewrites
- Locally, no `PORTAL_TOKEN` env var → backend middleware skips the check
- In production, both are set

### Open questions

- Inject the token client-side (simpler, public knowledge) or server-side
  via Pages middleware (slightly more secure, more wiring)?

## Out of scope (skipped vs. previous draft)

- ~~Phase 2 — Backend on Fly.io~~ → stays on Oracle ARM VM
- ~~Phase 3 — Multi-tenancy (Supabase Auth, RLS, per-user secrets)~~ → single user
- ~~Phase 4 — Cloudflare-native polish~~ → revisit if/when relevant
- ~~Cloudflare Access~~ → replaced by simpler shared-token approach

## Implementation order

1. **Phase 1a** (free quick tunnel) — confirm everything works end-to-end with a `.trycloudflare.com` URL
2. **Phase 3** (token auth) — lock it down before exposing publicly
3. **Phase 2** (Pages deploy) — point the new frontend at the tunnel URL
4. Use the portal from your phone / a coffee shop laptop, confirm it works
5. **Decide on Phase 1b** — if the URL rotation becomes a real pain (more than once a month?), spend $10 on a stable domain. Otherwise stay free.

**Total time estimate: 2–3 hours of actual work, almost all of it config / dashboard clicks rather than code.**

## Files this plan would touch

- New: `portal/frontend/wrangler.toml`
- Modified: `portal/backend/main.py` (token middleware), `portal/.env.example` (document `PORTAL_TOKEN`), `portal/frontend/src/lib/api.ts` (token header — if going client-side route)
- New: systemd unit file for `cloudflared` (one-time setup, not in repo)
