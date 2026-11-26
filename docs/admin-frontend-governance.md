# Admin Frontend Governance

## List Pages

- Top-level list pages should use `usePaginatedList` for server-side pagination.
- Top-level list pages should pass `listPagination` to `DataTable` instead of writing inline `pagination={{ ... }}`.
- Filter and search changes should be represented as hook dependencies. The hook resets to page 1 when dependencies change.
- API clients should return `PaginatedResult<T>`-compatible data: `items`, `total`, and optional `page`, `pageSize`, `totalPages`.
- Direct AntD `Table` usage is reserved for small nested tables, modal details, or domain-specific widgets that do not use server-side pagination.

## Page Boundaries

- `index.tsx` should coordinate the page only: state wiring, page header, and composition.
- Large table columns, modal forms, detail drawers, and formatters should be extracted into local `components`, `hooks`, `types`, and `formatters` files.
- A page file over 700 lines should be treated as a refactor candidate. A page over 1,000 lines should not receive new feature work before a split plan is created.

## User Feedback

- Prefer `App.useApp()` for `message`, `modal`, and `notification` so AntD context and layering are consistent.
- Page-level actions should use a common reload path after mutations instead of duplicating list fetch logic.

## Migration Order

1. Migrate simple server-paginated pages to `usePaginatedList` and `DataTable.listPagination`.
2. Split high-change pages such as `EnterpriseAccounts` into tables, modals, drawers, and hooks.
3. Treat finance and reconciliation pages separately when cursor pagination or report-specific tables are involved.
