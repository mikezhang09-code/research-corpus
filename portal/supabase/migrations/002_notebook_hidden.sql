-- Add a `hidden` flag to notebooks so the "Hide from list" action can
-- remove a notebook from the portal's main list without dropping its
-- saved artifacts (which would happen via ON DELETE CASCADE on
-- nlm_artifacts.notebook_id). The notebook stays in NotebookLM and can
-- be brought back by clearing the flag or re-syncing.

ALTER TABLE notebooks
  ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_notebooks_hidden ON notebooks(hidden);
