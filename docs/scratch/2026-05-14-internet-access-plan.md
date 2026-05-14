# Internet Access Plan — research-corpus portal

**Date:** 2026-05-14
**Status:** Approved approach — ready to implement
**Scope:** Personal single-user access (Mike) from any device/network. No multi-tenancy.
**Supersedes:** `docs/scratch/2026-05-10-cloudflare-deployment-plan.md` (the Cloudflare Pages
approach is dropped — see "Why this changed" below).

## Goal

Reach the portal from any device on any network — phone, laptop, coffee shop — without
keeping an SSH session open, without port-forwarding, and without exposing the VM directly.

## Why this changed from the 2026-05-10 draft

The old draft moved the **frontend to Cloudflare Pages** via `@cloudflare/next-on-pages`.
We're now on **Next.js 16.2.6**, where that adapter carries real compatibility risk, plus it
adds a build pipeline and env-var syncing for zero benefit at one-user scale.

New approach: **tunnel the frontend itself.** The frontend's existing Next.js rewrites
already proxy `/api/*` → `127.0.0.1:8000`, so the backend is never publicly exposed, there's
no Pages build, no adapter, and the whole stack stays on the VM.

Auth: **Cloudflare Access** (chosen) gates the tunnel hostname with a login — **zero
application code changes**. No token middleware, no login page, no CORS edits.

## Final architecture

```
   Browser anywhere
         │  https://research.<domain>
         ▼
   Cloudflare edge ── Cloudflare Access (login gate; only Mike's email passes)
         │
         ▼
   Cloudflare Tunnel (outbound-only connection from the VM — no inbound ports)
         │
         ▼
   Oracle ARM VM
     ├─ Next.js frontend  127.0.0.1:3000   (npm run start, production build)
     │     └─ Next.js rewrites /api/* ──► 127.0.0.1:8000
     └─ FastAPI backend   127.0.0.1:8000   (uvicorn, no --reload)
```

- Both services bind to **localhost only** — nothing is reachable except through the tunnel.
- The tunnel is an **outbound** connection, so **no Oracle Cloud security-list / inbound
  firewall changes** are needed.
- Cost: ~**$10/yr** for the domain. Everything else (Tunnel, Access, ~1 user) is free.

## Phase 1 — Production-ize the VM stack

**Effort:** ~45 min · **Touches code/config on the VM**

Today both services run as foreground dev processes (`uvicorn --reload`, `npm run dev`).
For an always-on deployment they need production mode + systemd so they survive SSH
disconnect and reboot.

1. **Frontend → production build.** Confirm `npm run build` succeeds. **Known risk:**
   `next build` runs ESLint and fails on *errors*; we have a couple of pre-existing
   `react-hooks/set-state-in-effect` errors (`NotebookDescription.tsx`, `library/page.tsx`,
   possibly `notebooklm/page.tsx`). Fix them with targeted `eslint-disable-next-line`
   comments (consistent with the one already on `useModalPortal`), or address the root
   cause. Then run via `next start -H 127.0.0.1 -p 3000`.
2. **Backend → no reload.** Run `uvicorn portal.backend.main:app --host 127.0.0.1 --port 8000`
   (drop `--reload`, which is dev-only).
3. **systemd units** (3 files in `/etc/systemd/system/`, reference copies committed to
   `portal/deploy/` so they're not lost):
   - `research-portal-backend.service` — runs uvicorn, `WorkingDirectory` = repo root,
     `EnvironmentFile` = `portal/.env`, `Restart=always`
   - `research-portal-frontend.service` — runs `next start`, `After=` the backend
   - (cloudflared unit comes in Phase 3)
4. `systemctl enable --now` both; verify `curl 127.0.0.1:3000` and `curl 127.0.0.1:8000/api/health`.

**Note:** CORS in `main.py` stays as-is. The browser only ever talks to the tunnel origin;
the `/api/*` calls are server-side proxied by Next.js, so they're not subject to browser CORS.

## Phase 2 — Domain + Cloudflare zone

**Effort:** ~15 min · **User action (purchase) — I can't buy it for you**

1. Buy a domain at **Cloudflare Registrar** (Dashboard → Domain Registration). At-cost
   pricing, and it becomes a Cloudflare zone automatically — no nameserver step.
   (If you'd rather buy elsewhere: buy it, then add it as a Cloudflare zone and switch
   nameservers — one extra step, same end result.)
2. Decide the hostname for the portal — suggest `research.<domain>` or `portal.<domain>`.
   The rest of the domain stays free for future apps.

## Phase 3 — Named Cloudflare Tunnel for the frontend

**Effort:** ~30 min · **VM setup**

1. Install `cloudflared` on the ARM64 VM (official arm64 `.deb` or apt repo).
2. `cloudflared tunnel login` — prints a URL; open it in any browser, authorize the zone.
3. `cloudflared tunnel create research-portal` — creates the tunnel + credentials file.
4. Write `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: research-portal
   credentials-file: /home/ubuntu/.cloudflared/<tunnel-id>.json
   ingress:
     - hostname: research.<domain>
       service: http://127.0.0.1:3000
     - service: http_status:404
   ```
5. `cloudflared tunnel route dns research-portal research.<domain>` — creates the DNS record.
6. `sudo cloudflared service install` — installs the systemd unit, persistent across reboot.
7. Verify: open `https://research.<domain>` — should load the portal (still unguarded at
   this point; Phase 4 locks it).

## Phase 4 — Cloudflare Access (login gate)

**Effort:** ~15 min · **Dashboard only, zero code**

1. Cloudflare dashboard → **Zero Trust** → Access → Applications → Add a **self-hosted**
   application for `research.<domain>`.
2. Add a policy: **Allow**, rule = `Emails` is `mike.zhang09@gmail.com`.
3. Identity method — **One-Time PIN** is the zero-setup option (Cloudflare emails you a
   6-digit code on each new session; no Google OAuth app to configure). Google login is
   available as an alternative if you'd rather click "Sign in with Google".
4. Set the session duration long (e.g. 1 month) so you're not logging in constantly.
5. Verify: open the URL in a fresh browser / incognito → Cloudflare login page → enter
   PIN → portal loads. Try a non-allowed email → denied.

## Phase 5 — End-to-end verification

**Effort:** ~15 min

From a phone or an external network (not the VM, not your LAN):
- Load `https://research.<domain>`, pass the Access gate
- Sync notebooks, open a notebook, run a chat turn (MiMo, ~60s), generate an artifact
- Open the Markdown / flashcards / mind-map viewers
- Confirm the collapsible panels and language toggle work

## What this does NOT require

- ❌ No application code changes (Access handles auth; CORS unchanged; `next.config.ts`
      `BACKEND_URL` default already correct)
- ❌ No Oracle Cloud inbound firewall / security-list changes (tunnel is outbound-only)
- ❌ No Cloudflare Pages, no `@cloudflare/next-on-pages`, no build pipeline
- ❌ No shared-token middleware or login page
- ❌ No static IP, no port forwarding, no router config

## Files this plan touches

- **Modified (code):** the 2–3 files with `set-state-in-effect` lint errors — targeted
  `eslint-disable-next-line` comments so `next build` passes
- **New (committed):** `portal/deploy/research-portal-backend.service`,
  `portal/deploy/research-portal-frontend.service` — reference copies of the systemd units
- **New (committed):** `portal/deploy/README.md` — short runbook (install steps, how to
  restart, where the tunnel config lives)
- **New (on the VM only, not committed):** `/etc/systemd/system/*.service` (the live
  units), `~/.cloudflared/config.yml`, `~/.cloudflared/<tunnel-id>.json`
- **Updated:** this file → mark Phase status as we go; `README.md` deployment note

## Implementation order

1. Phase 1 — production-ize + systemd (works the same locally; safe to do first)
2. Phase 2 — buy domain (your action; can happen in parallel with Phase 1)
3. Phase 3 — install + configure the tunnel
4. Phase 4 — turn on Access
5. Phase 5 — verify from an external device

**Total: ~2 hours, almost all of it VM setup and dashboard clicks. The only code change
is silencing pre-existing lint errors so the production build passes.**
