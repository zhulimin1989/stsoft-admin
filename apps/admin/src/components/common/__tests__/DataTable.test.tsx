import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DataTable } from '../DataTable';

interface Row {
  id: string;
  name: string;
}
const rows: Row[] = [
  { id: '1', name: 'Alice' },
  { id: '2', name: 'Bob' },
];

describe('DataTable', () => {
  it('renders rows', () => {
    render(
      <DataTable<Row>
        columns={[{ title: '姓名', dataIndex: 'name', key: 'name' }]}
        dataSource={rows}
        rowKey="id"
      />,
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('triggers onRowClick', () => {
    const onRowClick = vi.fn();
    render(
      <DataTable<Row>
        columns={[{ title: '姓名', dataIndex: 'name', key: 'name' }]}
        dataSource={rows}
        rowKey="id"
        onRowClick={onRowClick}
      />,
    );
    fireEvent.click(screen.getByText('Alice'));
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it('marks selected row', () => {
    const { container } = render(
      <DataTable<Row>
        columns={[{ title: '姓名', dataIndex: 'name', key: 'name' }]}
        dataSource={rows}
        rowKey="id"
        selectedRowKey="1"
      />,
    );
    const selected = container.querySelector('.ant-table-row.rt-row-selected');
    expect(selected).not.toBeNull();
  });

  it('marks selected row with function rowKey', () => {
    const { container } = render(
      <DataTable<Row>
        columns={[{ title: '姓名', dataIndex: 'name', key: 'name' }]}
        dataSource={rows}
        rowKey={(row) => row.id}
        selectedRowKey="2"
      />,
    );
    const selected = container.querySelector('.ant-table-row.rt-row-selected');
    expect(selected).toHaveTextContent('Bob');
  });

  it('uses shared list pagination config', () => {
    const onChange = vi.fn();
    render(
      <DataTable<Row>
        columns={[{ title: '姓名', dataIndex: 'name', key: 'name' }]}
        dataSource={rows}
        rowKey="id"
        listPagination={{
          current: 1,
          total: 42,
          pageSize: 20,
          onChange,
        }}
      />,
    );
    expect(screen.getByText('共 42 条')).toBeInTheDocument();
  });

  it('normalizes native pagination config', () => {
    render(
      <DataTable<Row>
        columns={[{ title: '姓名', dataIndex: 'name', key: 'name' }]}
        dataSource={rows}
        rowKey="id"
        pagination={{ current: 1, total: 42, pageSize: 1 }}
      />,
    );

    expect(screen.getByText('共 42 条')).toBeInTheDocument();
  });

  it('filters local rows with the built-in search', () => {
    const onSearchChange = vi.fn();
    render(
      <DataTable<Row>
        columns={[{ title: '姓名', dataIndex: 'name', key: 'name' }]}
        dataSource={rows}
        rowKey="id"
        searchable
        onSearchChange={onSearchChange}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('搜索表格内容'), {
      target: { value: 'bob' },
    });

    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(onSearchChange).toHaveBeenCalledWith('bob');
  });

  it('lets a controlled search value clear the input and local filter', () => {
    const { rerender } = render(
      <DataTable<Row>
        columns={[{ title: '姓名', dataIndex: 'name', key: 'name' }]}
        dataSource={rows}
        rowKey="id"
        searchable
        searchValue="bob"
      />,
    );

    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();

    rerender(
      <DataTable<Row>
        columns={[{ title: '姓名', dataIndex: 'name', key: 'name' }]}
        dataSource={rows}
        rowKey="id"
        searchable
        searchValue=""
      />,
    );

    expect(screen.getByPlaceholderText('搜索表格内容')).toHaveValue('');
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('preserves custom rowClassName with selected row class', () => {
    const { container } = render(
      <DataTable<Row>
        columns={[{ title: '姓名', dataIndex: 'name', key: 'name' }]}
        dataSource={rows}
        rowKey="id"
        selectedRowKey="1"
        rowClassName={(row) => (row.id === '1' ? 'dirty-row' : '')}
      />,
    );

    const selected = container.querySelector('.ant-table-row.rt-row-selected');
    expect(selected).toHaveClass('dirty-row');
  });
});
