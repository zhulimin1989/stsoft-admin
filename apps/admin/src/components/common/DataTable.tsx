import { Input, Table, TableProps } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useMemo, useState } from 'react';
import {
  createTablePagination,
  normalizeTablePagination,
  type TablePaginationState,
} from './tablePagination';
import './DataTable.css';

export interface DataTableProps<T>
  extends Omit<TableProps<T>, 'onRow'> {
  selectedRowKey?: string | number;
  onRowClick?: (record: T) => void;
  listPagination?: TablePaginationState | false;
  searchable?: boolean;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
}

function getRecordKey<T extends object>(
  record: T,
  index: number,
  rowKey: TableProps<T>['rowKey'],
) {
  if (typeof rowKey === 'function') {
    return rowKey(record, index);
  }
  if (typeof rowKey === 'string') {
    return (record as Record<string, unknown>)[rowKey];
  }
  return (record as Record<string, unknown>).key;
}

export function DataTable<T extends object>(props: DataTableProps<T>) {
  const {
    selectedRowKey,
    onRowClick,
    listPagination,
    rowClassName,
    searchable = false,
    searchPlaceholder = '搜索表格内容',
    searchValue,
    onSearchChange,
    dataSource,
    ...rest
  } = props;
  const [internalSearch, setInternalSearch] = useState('');
  const search = searchValue ?? internalSearch;
  const filteredDataSource = useMemo(() => {
    if (!searchable || !search.trim()) return dataSource;
    const query = search.trim().toLowerCase();
    return dataSource?.filter((record) =>
      JSON.stringify(record).toLowerCase().includes(query),
    );
  }, [dataSource, searchable, search]);
  const pagination =
    listPagination === undefined
      ? normalizeTablePagination(rest.pagination)
      : listPagination === false
        ? false
        : createTablePagination(listPagination);

  return (
    <div className="rt-table">
      {searchable && (
        <div className="rt-table-search">
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder={searchPlaceholder}
            value={search}
            onChange={(event) => {
              const value = event.target.value;
              if (searchValue === undefined) setInternalSearch(value);
              onSearchChange?.(value);
            }}
          />
        </div>
      )}
      <Table<T>
        {...rest}
        dataSource={filteredDataSource}
        pagination={pagination}
        rowClassName={(record, index, indent) => {
          const key = getRecordKey(record, index, props.rowKey);
          const baseClassName = typeof rowClassName === 'function'
            ? rowClassName(record, index, indent)
            : rowClassName;
          const selectedClassName = selectedRowKey != null && String(key) === String(selectedRowKey)
            ? 'rt-row-selected'
            : '';
          return [baseClassName, selectedClassName].filter(Boolean).join(' ');
        }}
        onRow={(record) => ({
          onClick: () => onRowClick?.(record),
          style: onRowClick ? { cursor: 'pointer' } : undefined,
        })}
      />
    </div>
  );
}
