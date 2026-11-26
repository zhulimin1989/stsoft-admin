-- Existing production admin databases may predate the 2026-05-18 baseline.
-- The baseline uses CREATE TABLE IF NOT EXISTS, which does not add columns to
-- already-existing tables. Keep this migration idempotent so fresh databases
-- and repaired databases can both replay it safely.

ALTER TABLE "announcements"
  ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'info',
  ADD COLUMN IF NOT EXISTS "target_audience" TEXT NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "feature_flags"
  ADD COLUMN IF NOT EXISTS "description" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "scope" TEXT NOT NULL DEFAULT 'global',
  ADD COLUMN IF NOT EXISTS "scope_value" TEXT;

ALTER TABLE "system_prompts"
  ADD COLUMN IF NOT EXISTS "name" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "description" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
