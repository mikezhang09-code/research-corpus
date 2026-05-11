-- =============================================================================
-- Migration 004: Library Notebooks
-- Adds library_notebooks and library_notebook_chat tables,
-- and extends library_items with notebook_id + file_category.
-- =============================================================================

-- -------------------------------------------------------------------------
-- Table: library_notebooks
-- User-created notebooks that group library files
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS library_notebooks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text        NOT NULL DEFAULT 'Untitled',
  description text        NOT NULL DEFAULT '',
  cover_emoji text,
  hidden      bool        NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE library_notebooks DISABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------------------------
-- Table: library_notebook_chat
-- Chat history for each library notebook (backed by Claude API)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS library_notebook_chat (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id uuid        NOT NULL REFERENCES library_notebooks(id) ON DELETE CASCADE,
  role        text        NOT NULL CHECK (role IN ('user', 'assistant')),
  content     text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE library_notebook_chat DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_library_chat_notebook_created
  ON library_notebook_chat (notebook_id, created_at);

-- -------------------------------------------------------------------------
-- Extend: library_items
-- Add notebook grouping and file category columns
-- -------------------------------------------------------------------------
ALTER TABLE library_items
  ADD COLUMN IF NOT EXISTS notebook_id   uuid REFERENCES library_notebooks(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS file_category text NOT NULL DEFAULT 'other';

CREATE INDEX IF NOT EXISTS idx_library_items_notebook_id
  ON library_items (notebook_id);

CREATE INDEX IF NOT EXISTS idx_library_items_file_category
  ON library_items (file_category);

-- -------------------------------------------------------------------------
-- Data migration: create a default "General" notebook and assign all
-- existing library_items (those without a notebook_id) to it.
-- -------------------------------------------------------------------------
DO $$
DECLARE
  general_id uuid;
BEGIN
  INSERT INTO library_notebooks (title, description)
    VALUES ('General', 'Default notebook for existing library items')
    RETURNING id INTO general_id;

  UPDATE library_items
    SET notebook_id = general_id
    WHERE notebook_id IS NULL;
END $$;
