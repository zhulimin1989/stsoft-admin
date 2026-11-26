import type { TablePaginationConfig } from 'antd/es/table';

export const DEFAULT_TABLE_PAGE_SIZE = 20;
const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export interface TablePaginationState {
  current: number;
  total: number;
  pageSize?: number;
  onChange: (page: number, pageSize: number) => void;
  showSizeChanger?: boolean;
  pageSizeOptions?: number[];
  disabled?: boolean;
  size?: TablePaginationConfig['size'];
}

export function createTablePagination({
  current,
  total,
  pageSize = DEFAULT_TABLE_PAGE_SIZE,
  onChange,
  showSizeChanger = false,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  disabled,
  size,
}: TablePaginationState): TablePaginationConfig {
  return {
    current,
    total,
    pageSize,
    disabled,
    size,
    showSizeChanger,
    pageSizeOptions: pageSizeOptions.map(String),
    showTotal: (value) => `共 ${value} 条`,
    onChange,
    onShowSizeChange: onChange,
  };
}

export function normalizeTablePagination(
  pagination: TablePaginationConfig | false | undefined,
): TablePaginationConfig | false | undefined {
  if (pagination === false || pagination == null) return pagination;

  return {
    ...pagination,
    showSizeChanger: pagination.showSizeChanger ?? false,
    pageSizeOptions: (pagination.pageSizeOptions ?? DEFAULT_PAGE_SIZE_OPTIONS).map(String),
    showTotal: pagination.showTotal ?? ((value) => `共 ${value} 条`),
  };
}
