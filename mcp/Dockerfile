# ── Build stage ────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy the entire workspace
COPY . .

WORKDIR /app/mcp

# Create venv and install dependencies
RUN uv venv .venv && \
    uv pip install --python .venv/bin/python -e .

# ── Runtime stage ────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

WORKDIR /app/mcp

# Copy the whole /app from builder so the editable install of notebooklm-py is preserved
COPY --from=builder /app /app

# Activate the venv by updating PATH
ENV PATH="/app/mcp/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 8089

CMD ["python", "-m", "nblm_mcp_server", "--transport", "http", "--host", "0.0.0.0", "--port", "8089"]
