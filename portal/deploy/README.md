# Portal deployment — always-on runbook

The portal runs as two systemd services on the Oracle ARM VM so it survives
SSH disconnects and reboots. Access is over **Tailscale** — open
`http://<vm-tailscale-ip>:3000` from any device on the tailnet (or the SSH
port-forward `localhost:3000` as before). No domain, no Cloudflare, no public
inbound ports.

## Services

| Unit | What | Bind |
|---|---|---|
| `research-portal-backend.service` | FastAPI (uvicorn, no `--reload`) | `127.0.0.1:8000` |
| `research-portal-frontend.service` | Next.js production (`next start`) | `0.0.0.0:3000` |

The frontend proxies `/api/*` → `127.0.0.1:8000` via Next.js rewrites, so the
backend is never bound to a public/tailnet interface.

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
  The Oracle Cloud **security list must not expose port 3000** to the public —
  Tailscale's private mesh + that cloud firewall are what keep it single-user.
