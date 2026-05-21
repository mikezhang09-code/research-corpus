# Portal deployment — always-on runbook

The portal runs as two systemd services on the Oracle ARM VM so it survives
SSH disconnects and reboots. Access is over **Tailscale** — open
`http://<vm-tailscale-ip>:3001` from any device on the tailnet (or the SSH
port-forward `localhost:3001` as before). No domain, no Cloudflare, no public
inbound ports.

## Services

| Unit | What | Bind |
|---|---|---|
| `research-portal-backend.service` | FastAPI (uvicorn, no `--reload`) | `127.0.0.1:8000` |
| `research-portal-frontend.service` | Next.js production (`next start`) | `0.0.0.0:3001` |

The frontend proxies `/api/*` → `127.0.0.1:8000` via Next.js rewrites, so the
backend is never bound to a public/tailnet interface.

The frontend listens on **3001**, not 3000 — port 3000 is taken by another
local service. The port lives in `ExecStart` (`next start ... -p 3001`) in
`research-portal-frontend.service`.

## Install (one-time)

```bash
sudo cp portal/deploy/research-portal-backend.service  /etc/systemd/system/
sudo cp portal/deploy/research-portal-frontend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now research-portal-backend.service
sudo systemctl enable --now research-portal-frontend.service
```

## After pulling new code

```bash
# backend: just restart
sudo systemctl restart research-portal-backend.service

# frontend: rebuild first (production build is not hot-reloaded)
cd portal/frontend && npm run build
sudo systemctl restart research-portal-frontend.service
```

## Start / stop / restart

The one-time install above (`enable --now`) already starts both services and
makes them launch on boot. To control them afterwards:

```bash
sudo systemctl start   research-portal-{backend,frontend}.service
sudo systemctl stop    research-portal-{backend,frontend}.service
sudo systemctl restart research-portal-{backend,frontend}.service
```

## Common commands

```bash
systemctl status  research-portal-{backend,frontend}.service
journalctl -u research-portal-backend.service  -f
journalctl -u research-portal-frontend.service -f
sudo systemctl restart research-portal-frontend.service
```

## Security boundary

- Backend binds `127.0.0.1` only — unreachable except via the frontend's proxy.
- Frontend binds `0.0.0.0` so the SSH forward *and* the Tailscale IP both work.
  The Oracle Cloud **security list must not expose port 3001** to the public —
  Tailscale's private mesh + that cloud firewall are what keep it single-user.

---

# Public viewer

`portal/public/` is a separate, **public-facing**, **view-only** app — browse
*My Research* folios and the saved *NotebookLM Corpus*. It is a standalone
Cloudflare Worker that reads Supabase and R2 directly; it does **not** involve
this VPS, this backend, or a tunnel. The private Tailscale portal above is
entirely unchanged.

Build, deploy, and Cloudflare Access setup are documented in
[`portal/public/README.md`](../public/README.md).
