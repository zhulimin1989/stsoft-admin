export interface ListQueryParams {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T, TMeta = unknown> {
  items: T[];
  total: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  meta?: TMeta;
}

export interface PageState {
  page: number;
  pageSize: number;
}
