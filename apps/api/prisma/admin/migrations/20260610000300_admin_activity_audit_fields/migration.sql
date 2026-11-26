ALTER TABLE "admin_activity_logs"
  ADD COLUMN IF NOT EXISTS "resource" TEXT,
  ADD COLUMN IF NOT EXISTS "resource_id" TEXT,
  ADD COLUMN IF NOT EXISTS "request_id" TEXT,
  ADD COLUMN IF NOT EXISTS "before" TEXT,
  ADD COLUMN IF NOT EXISTS "after" TEXT;

CREATE INDEX IF NOT EXISTS "admin_activity_logs_resource_resource_id_idx"
  ON "admin_activity_logs"("resource", "resource_id");

CREATE INDEX IF NOT EXISTS "admin_activity_logs_request_id_idx"
  ON "admin_activity_logs"("request_id");
