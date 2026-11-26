# codesphere-admin

Internal admin-facing repository.

This repo owns:
- `apps/admin`: admin frontend.
- `apps/api`: admin API runtime, started with `node dist/admin-main.js`.
- `packages/shared`: local shared contracts used by the frontend and API.

Runtime boundary:
- Admin frontend should be reachable only from company network / VPN / access proxy.
- Admin API calls billing through `BILLING_SERVICE_URL`.
- Admin API should not use `BILLING_DATABASE_URL`.
- Admin API owns only `ADMIN_DATABASE_URL` / `ruidong_admin`.
- Admin API must not run console or billing migrations.
- Default `prisma:seed` targets the split admin DB only; legacy console seed is disabled.
- Production env contract: `.env.production.example`.
- Production DB migration entry: `pnpm db:migrate:prod`.
- Safe production bootstrap entry: `pnpm db:bootstrap:prod`; it seeds roles and only creates a super admin when `ADMIN_BOOTSTRAP_EMAIL` plus `ADMIN_BOOTSTRAP_PASSWORD_HASH` or `ADMIN_BOOTSTRAP_PASSWORD` is explicitly provided.
- Cross-service ownership contract: `../codesphere-ops/docs/architecture/service-db-ownership.md`.

Common commands:

```bash
pnpm install
pnpm build
pnpm start:api
pnpm db:migrate:prod
pnpm db:bootstrap:prod
```

Docker:

```bash
docker build -f Dockerfile.api -t codesphere-admin-api .
docker build -f Dockerfile.web -t codesphere-admin-web .
```
