DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AlertEventCategory') THEN
    CREATE TYPE "AlertEventCategory" AS ENUM ('PAYMENT', 'CHANNEL', 'USAGE', 'SECURITY', 'SYSTEM');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AlertEventSeverity') THEN
    CREATE TYPE "AlertEventSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AlertEventStatus') THEN
    CREATE TYPE "AlertEventStatus" AS ENUM ('PENDING', 'READ', 'HANDLED');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "alert_events" (
  "id" TEXT NOT NULL,
  "category" "AlertEventCategory" NOT NULL,
  "severity" "AlertEventSeverity" NOT NULL,
  "status" "AlertEventStatus" NOT NULL DEFAULT 'PENDING',
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "source_type" TEXT,
  "source_id" TEXT,
  "user_id" TEXT,
  "context" TEXT NOT NULL DEFAULT '{}',
  "read_at" TIMESTAMP(3),
  "handled_at" TIMESTAMP(3),
  "handled_by" TEXT,
  "handle_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "alert_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "alert_events_category_status_created_at_idx"
  ON "alert_events"("category", "status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "alert_events_severity_status_created_at_idx"
  ON "alert_events"("severity", "status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "alert_events_user_id_created_at_idx"
  ON "alert_events"("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "alert_events_status_created_at_idx"
  ON "alert_events"("status", "created_at" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'alert_events_handled_by_fkey'
  ) THEN
    ALTER TABLE "alert_events"
      ADD CONSTRAINT "alert_events_handled_by_fkey"
      FOREIGN KEY ("handled_by") REFERENCES "admin_members"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;
