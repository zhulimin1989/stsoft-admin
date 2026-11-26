ALTER TABLE "system_configs"
  ADD COLUMN IF NOT EXISTS "version" BIGINT NOT NULL DEFAULT 0;

WITH legacy AS (
  SELECT
    COALESCE(MAX(CASE WHEN "key" = 'platformConfig' THEN "value" END)::jsonb, '{}'::jsonb) AS platform,
    COALESCE(MAX(CASE WHEN "key" = 'authConfig' THEN "value" END)::jsonb, '{}'::jsonb) AS auth,
    COALESCE(MAX(CASE WHEN "key" = 'oauthConfig' THEN "value" END)::jsonb, '{}'::jsonb) AS oauth
  FROM "system_configs"
), normalized AS (
  SELECT
    CASE
      WHEN lower(COALESCE(platform->>'region', '')) IN ('domestic', 'cn', 'china') THEN 'domestic'
      WHEN lower(COALESCE(platform->>'region', '')) IN ('overseas', 'global', 'intl', 'international') THEN 'overseas'
      WHEN lower(COALESCE(auth->>'provider', '')) = 'authing' THEN 'domestic'
      WHEN lower(COALESCE(auth->>'provider', '')) = 'auth0' THEN 'overseas'
      ELSE NULL
    END AS region,
    platform,
    oauth
  FROM legacy
)
INSERT INTO "system_configs" (
  "id", "key", "value", "version", "description", "created_at", "updated_at"
)
SELECT
  'deployment-config',
  'deploymentConfig',
  jsonb_build_object(
    'region', region,
    'currency', lower(COALESCE(NULLIF(platform->>'currency', ''), CASE WHEN region = 'domestic' THEN 'cny' ELSE 'usd' END)),
    'defaultLanguage', lower(COALESCE(NULLIF(platform->>'defaultLanguage', ''), CASE WHEN region = 'domestic' THEN 'zh' ELSE 'en' END)),
    'oauth', oauth
  )::text,
  1,
  '统一部署运行时配置；provider 由 region 派生',
  NOW(),
  NOW()
FROM normalized
WHERE region IS NOT NULL
ON CONFLICT ("key") DO NOTHING;

-- Admin is the version authority. Recover a pre-existing bootstrap row left at the
-- schema default so the first downstream reconciliation carries a positive version.
UPDATE "system_configs"
SET "version" = 1
WHERE "key" = 'deploymentConfig' AND "version" = 0;

-- Legacy rows are no longer written after this migration. They are retained only so a
-- rolling deployment can safely run an older admin-api until the release window closes.
