CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" TEXT NOT NULL,
  "user_id" TEXT,
  "target_user_id" TEXT,
  "resource_id" TEXT,
  "action" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "detail" TEXT,
  "ip" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "audit_logs_user_id_idx" ON "audit_logs"("user_id");
CREATE INDEX IF NOT EXISTS "audit_logs_target_user_id_idx" ON "audit_logs"("target_user_id");
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs"("created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs"("action");
CREATE INDEX IF NOT EXISTS "audit_logs_resource_idx" ON "audit_logs"("resource");

CREATE TABLE IF NOT EXISTS "announcements" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'info',
  "target_audience" TEXT NOT NULL DEFAULT 'all',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "feature_flags" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" BOOLEAN NOT NULL DEFAULT false,
  "description" TEXT NOT NULL DEFAULT '',
  "scope" TEXT NOT NULL DEFAULT 'global',
  "scope_value" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "feature_flags_key_key" ON "feature_flags"("key");

CREATE TABLE IF NOT EXISTS "system_prompts" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT '',
  "content" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "system_prompts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "system_prompts_key_key" ON "system_prompts"("key");

CREATE TABLE IF NOT EXISTS "system_configs" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL DEFAULT '{}',
  "description" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "system_configs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "system_configs_key_key" ON "system_configs"("key");

CREATE TABLE IF NOT EXISTS "admin_roles" (
  "id" TEXT NOT NULL,
  "key" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "permissions" TEXT NOT NULL DEFAULT '[]',
  "is_system" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_roles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "admin_roles_key_key" ON "admin_roles"("key");

CREATE TABLE IF NOT EXISTS "admin_members" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "password" TEXT NOT NULL,
  "nickname" TEXT NOT NULL,
  "preset_role" TEXT NOT NULL,
  "permissions" TEXT NOT NULL DEFAULT '{}',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "invited_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "role_id" TEXT,
  "name" TEXT NOT NULL DEFAULT '',
  "phone" TEXT,
  "department" TEXT,
  "last_login_at" TIMESTAMP(3),
  "password_changed_at" TIMESTAMP(3),
  "must_change_password" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "admin_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "admin_members_email_key" ON "admin_members"("email");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admin_members_role_id_fkey'
  ) THEN
    ALTER TABLE "admin_members"
      ADD CONSTRAINT "admin_members_role_id_fkey"
      FOREIGN KEY ("role_id") REFERENCES "admin_roles"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "admin_activity_logs" (
  "id" TEXT NOT NULL,
  "admin_member_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "operator_admin_id" TEXT,
  "ip" TEXT,
  "user_agent" TEXT,
  "detail" TEXT NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_activity_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "admin_activity_logs_admin_member_id_idx"
  ON "admin_activity_logs"("admin_member_id");
CREATE INDEX IF NOT EXISTS "admin_activity_logs_action_idx"
  ON "admin_activity_logs"("action");
CREATE INDEX IF NOT EXISTS "admin_activity_logs_created_at_idx"
  ON "admin_activity_logs"("created_at");

CREATE TABLE IF NOT EXISTS "alerts" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "metric" TEXT NOT NULL DEFAULT '',
  "condition" TEXT NOT NULL,
  "threshold" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "window_minutes" INTEGER NOT NULL DEFAULT 5,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);
