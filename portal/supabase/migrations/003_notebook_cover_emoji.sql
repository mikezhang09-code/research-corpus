-- Cover emoji per notebook (Google's NotebookLM landing page shows
-- 👑 ⚔️ 🎓 etc. as the visual identifier for each notebook). Nullable —
-- when NULL the frontend falls back to a deterministic-by-id pick from
-- the curated palette so existing rows still get a stable visual.

ALTER TABLE notebooks
  ADD COLUMN IF NOT EXISTS cover_emoji text;
