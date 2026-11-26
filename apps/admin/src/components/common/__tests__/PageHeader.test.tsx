import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { PageHeader } from '../PageHeader';

const wrap = (ui: React.ReactNode) => <MemoryRouter>{ui}</MemoryRouter>;

describe('PageHeader', () => {
  it('renders title and subtitle', () => {
    render(wrap(<PageHeader title="用户管理" subtitle="副标题" />));
    expect(screen.getByText('用户管理')).toBeInTheDocument();
    expect(screen.getByText('副标题')).toBeInTheDocument();
  });

  it('renders breadcrumb items as links and current page', () => {
    render(wrap(
      <PageHeader
        title="详情"
        breadcrumb={[{ label: '用户列表', to: '/users' }, '详情']}
      />,
    ));
    const link = screen.getByText('用户列表');
    expect(link.closest('a')).toHaveAttribute('href', '/users');
    expect(screen.getByText('详情', { selector: '.rt-ph-crumb-current' })).toBeInTheDocument();
  });

  it('renders action nodes', () => {
    render(wrap(
      <PageHeader
        title="x"
        actions={[<button key="a">导出</button>, <button key="b">新建</button>]}
      />,
    ));
    expect(screen.getByText('导出')).toBeInTheDocument();
    expect(screen.getByText('新建')).toBeInTheDocument();
  });

  it('omits subtitle when not provided', () => {
    const { container } = render(wrap(<PageHeader title="x" />));
    expect(container.querySelector('.rt-ph-sub')).toBeNull();
  });
});
