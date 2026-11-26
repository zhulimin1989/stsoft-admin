# Admin boundary migration - 2026-06-10

## Scope

This migration keeps `codesphere-admin` as the admin control-plane service only.
Admin owns `ADMIN_DATABASE_URL` and must not run billing/user/publisher/gateway
database migrations.

## Database changes

Apply the admin Prisma migrations from `codesphere-admin/apps/api`:

```bash
ADMIN_DATABASE_URL='postgresql://...' pnpm --filter @ruidong/api prisma:migrate:admin:deploy
```

The deployment applies these admin-owned changes:

- Create `alert_events` and its enum types in the admin database.
- Add structured audit columns to `admin_activity_logs`:
  - `resource`
  - `resource_id`
  - `request_id`
  - `before`
  - `after`
- Keep existing admin activity log rows. New columns are nullable, so no
  backfill is required for production to start.

## Removed admin runtime ownership

The root Prisma schema, root migration history, and root seed under
`apps/api/prisma/` were removed. Only `apps/api/prisma/admin/schema.prisma`
is owned by this repository now.

Do not run old root migrations from `codesphere-admin`. Billing/user data
structures are owned by their respective repositories.

## Manual data migration, if needed

`codingPlanProviderCredentials` is no longer read from admin `system_configs`.
Admin reads and writes this store through billing internal APIs only.

If production has a row like this in the admin database:

```sql
SELECT value FROM system_configs WHERE key = 'codingPlanProviderCredentials';
```

Move that JSON into billing before deploying this admin change. For a small
dataset, use the billing internal endpoint that backs
`BillingInternalClient.updateCodingPlanProviderCredentialStore`.

Run the migration through an authenticated admin API path or an admin
maintenance job that uses `BillingInternalClient`, so requests carry
`x-internal-caller: admin-api`, `x-internal-token: $ADMIN_TO_BILLING_TOKEN`,
and the signed admin context derived from `ADMIN_TO_BILLING_CONTEXT_SECRET`.
Billing no longer accepts the legacy single shared-token contract for
admin-originated internal requests.

After verifying the billing API returns the expected credential status, the old
admin `system_configs` row can be deleted:

```sql
DELETE FROM system_configs WHERE key = 'codingPlanProviderCredentials';
```

## Environment cleanup

Admin production should keep:

- `ADMIN_DATABASE_URL`
- `BILLING_SERVICE_URL`
- `ADMIN_TO_BILLING_TOKEN`
- `ADMIN_TO_BILLING_CONTEXT_SECRET`
- `USER_SERVICE_URL`
- `ADMIN_TO_USER_TOKEN`
- `ADMIN_TO_USER_CONTEXT_SECRET`
- admin runtime secrets such as JWT, cookie, Redis, metrics, and Sentry settings

Admin production should not set:

- `DATABASE_URL`
- `BILLING_DATABASE_URL`
- `USER_DATABASE_URL`
- `PUBLISHER_*`
- payment provider secrets such as `WECHAT_*`, `ALIPAY_*`, or `STRIPE_SECRET_KEY`
- gateway/publisher KMS or channel secret settings

## Verification

Run these checks before deploying:

```bash
ADMIN_DATABASE_URL='postgresql://...' pnpm --filter @ruidong/api exec prisma validate --schema prisma/admin/schema.prisma
pnpm db-boundary:check
ADMIN_DATABASE_URL='postgresql://...' pnpm --filter @ruidong/api typecheck
ADMIN_DATABASE_URL='postgresql://...' pnpm --filter @ruidong/api test -- --runInBand
ADMIN_DATABASE_URL='postgresql://...' pnpm --filter @ruidong/api build
```
