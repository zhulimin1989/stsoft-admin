import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FilterBar } from '../FilterBar';

describe('FilterBar', () => {
  it('renders search input', () => {
    render(<FilterBar search={{ placeholder: '搜索...', onSearch: () => {} }} />);
    expect(screen.getByPlaceholderText('搜索...')).toBeInTheDocument();
  });

  it('calls onSearch when input changes (debounced)', async () => {
    const onSearch = vi.fn();
    render(<FilterBar search={{ placeholder: '搜索', onSearch, debounceMs: 0 }} />);
    fireEvent.change(screen.getByPlaceholderText('搜索'), { target: { value: 'abc' } });
    await new Promise((r) => setTimeout(r, 5));
    expect(onSearch).toHaveBeenCalledWith('abc');
  });

  it('renders filter children', () => {
    render(
      <FilterBar filters={[<div key="x">F1</div>, <div key="y">F2</div>]} />,
    );
    expect(screen.getByText('F1')).toBeInTheDocument();
    expect(screen.getByText('F2')).toBeInTheDocument();
  });

  it('renders chips and triggers onRemove', () => {
    const onRemove = vi.fn();
    render(
      <FilterBar
        activeChips={[{ key: 'k', label: '异常账号', onRemove }]}
      />,
    );
    fireEvent.click(screen.getByLabelText('移除筛选: 异常账号'));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('renders right actions', () => {
    render(<FilterBar rightActions={<a>导出</a>} />);
    expect(screen.getByText('导出')).toBeInTheDocument();
  });
});
