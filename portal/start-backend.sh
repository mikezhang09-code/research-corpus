#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
exec .venv/bin/uvicorn portal.backend.main:app --reload --reload-dir portal/backend --port 8000
