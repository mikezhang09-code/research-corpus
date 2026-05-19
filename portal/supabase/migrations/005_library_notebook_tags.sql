-- =============================================================================
-- Migration 005: Library Notebook Tags
-- Adds a free-form text[] tag column to library_notebooks plus a GIN index
-- so list_notebooks can filter on `?tag=` cheaply.
-- =============================================================================

ALTER TABLE library_notebooks
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_library_notebooks_tags
  ON library_notebooks USING gin (tags);
