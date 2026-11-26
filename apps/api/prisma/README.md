# Prisma ownership

`codesphere-admin` owns only the split admin control-plane database:

- schema: `prisma/admin/schema.prisma`
- migrations: `prisma/admin/migrations`
- migration command: `pnpm prisma:migrate:prod`
- seed command: `pnpm prisma:seed` or `pnpm prisma:seed:admin`

The root `prisma/schema.prisma` and `prisma/migrations` directory are legacy
console-era artifacts kept only for historical reference during the split.
Do not run them against production. Console database migrations and seeds belong
to `codesphere-user`; billing database migrations and seeds belong to
`codesphere-billing`.
