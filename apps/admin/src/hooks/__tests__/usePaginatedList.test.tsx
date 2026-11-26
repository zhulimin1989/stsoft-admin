import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePaginatedList } from '../usePaginatedList';
import type { ListQueryParams, PaginatedResult } from '../../types/list';

interface Row {
  id: string;
}

interface HarnessProps {
  query: string;
  fetcher: (
    query: string,
    params: ListQueryParams,
  ) => Promise<PaginatedResult<Row>>;
  onSuccess?: (result: PaginatedResult<Row>) => void;
}

function Harness({ query, fetcher, onSuccess }: HarnessProps) {
  const list = usePaginatedList<Row>({
    fetcher: (params) => fetcher(query, params),
    deps: [query],
    onSuccess,
  });

  return (
    <div>
      <div data-testid="page">{list.page}</div>
      <div data-testid="total">{list.total}</div>
      <div data-testid="loading">{list.loading ? 'loading' : 'idle'}</div>
      {list.items.map((row) => (
        <div key={row.id}>{row.id}</div>
      ))}
      <button type="button" onClick={() => list.setPagination(2, 20)}>
        next
      </button>
    </div>
  );
}

function EnabledHarness({
  enabled,
  fetcher,
}: {
  enabled: boolean;
  fetcher: (params: ListQueryParams) => Promise<PaginatedResult<Row>>;
}) {
  const list = usePaginatedList<Row>({
    fetcher,
    enabled,
  });

  return (
    <div>
      <div data-testid="enabled-total">{list.total}</div>
      {list.items.map((row) => (
        <div key={row.id}>{row.id}</div>
      ))}
    </div>
  );
}

describe('usePaginatedList', () => {
  it('loads data and changes page through shared pagination state', async () => {
    const fetcher = vi.fn(
      async (
        query: string,
        params: ListQueryParams,
      ): Promise<PaginatedResult<Row>> => ({
        items: [{ id: `${query}-${params.page}` }],
        total: 31,
        page: params.page,
        pageSize: params.pageSize,
      }),
    );

    render(<Harness query="tickets" fetcher={fetcher} />);

    expect(await screen.findByText('tickets-1')).toBeInTheDocument();
    expect(screen.getByTestId('total')).toHaveTextContent('31');

    fireEvent.click(screen.getByText('next'));

    expect(await screen.findByText('tickets-2')).toBeInTheDocument();
    expect(fetcher).toHaveBeenLastCalledWith('tickets', {
      page: 2,
      pageSize: 20,
    });
  });

  it('resets to page 1 when dependencies change', async () => {
    const fetcher = vi.fn(
      async (
        query: string,
        params: ListQueryParams,
      ): Promise<PaginatedResult<Row>> => ({
        items: [{ id: `${query}-${params.page}` }],
        total: 10,
      }),
    );

    const { rerender } = render(<Harness query="open" fetcher={fetcher} />);
    expect(await screen.findByText('open-1')).toBeInTheDocument();

    fireEvent.click(screen.getByText('next'));
    expect(await screen.findByText('open-2')).toBeInTheDocument();

    rerender(<Harness query="closed" fetcher={fetcher} />);

    expect(await screen.findByText('closed-1')).toBeInTheDocument();
    expect(screen.getByTestId('page')).toHaveTextContent('1');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('ignores stale responses', async () => {
    const resolvers: Array<(value: PaginatedResult<Row>) => void> = [];
    const fetcher = vi.fn(
      () =>
        new Promise<PaginatedResult<Row>>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const { rerender } = render(<Harness query="old" fetcher={fetcher} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    rerender(<Harness query="new" fetcher={fetcher} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    act(() => {
      resolvers[1]?.({ items: [{ id: 'new-result' }], total: 1 });
    });
    expect(await screen.findByText('new-result')).toBeInTheDocument();

    act(() => {
      resolvers[0]?.({ items: [{ id: 'old-result' }], total: 1 });
    });
    expect(screen.queryByText('old-result')).not.toBeInTheDocument();
  });

  it('only calls onSuccess for the latest response', async () => {
    const resolvers: Array<(value: PaginatedResult<Row>) => void> = [];
    const fetcher = vi.fn(
      () =>
        new Promise<PaginatedResult<Row>>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const onSuccess = vi.fn();

    const { rerender } = render(
      <Harness query="old" fetcher={fetcher} onSuccess={onSuccess} />,
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    rerender(<Harness query="new" fetcher={fetcher} onSuccess={onSuccess} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    act(() => {
      resolvers[1]?.({ items: [{ id: 'new-result' }], total: 1 });
      resolvers[0]?.({ items: [{ id: 'old-result' }], total: 1 });
    });

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onSuccess).toHaveBeenCalledWith({
      items: [{ id: 'new-result' }],
      total: 1,
    });
  });

  it('does not fetch until enabled', async () => {
    const fetcher = vi.fn(
      async (): Promise<PaginatedResult<Row>> => ({
        items: [{ id: 'enabled-result' }],
        total: 1,
      }),
    );

    const { rerender } = render(
      <EnabledHarness enabled={false} fetcher={fetcher} />,
    );
    expect(fetcher).not.toHaveBeenCalled();

    rerender(<EnabledHarness enabled fetcher={fetcher} />);

    expect(await screen.findByText('enabled-result')).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
