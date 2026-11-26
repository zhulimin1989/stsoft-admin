import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DependencyList,
} from 'react';
import {
  DEFAULT_TABLE_PAGE_SIZE,
  type TablePaginationState,
} from '../components/common/tablePagination';
import type { ListQueryParams, PageState, PaginatedResult } from '../types/list';

export interface UsePaginatedListOptions<T, TMeta = unknown> {
  fetcher: (params: ListQueryParams) => Promise<PaginatedResult<T, TMeta>>;
  pageSize?: number;
  deps?: DependencyList;
  enabled?: boolean;
  clearOnError?: boolean;
  onError?: (error: unknown) => void;
  onSuccess?: (result: PaginatedResult<T, TMeta>) => void;
}

export interface UsePaginatedListResult<T, TMeta = unknown> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  error: unknown;
  data: PaginatedResult<T, TMeta>;
  tablePagination: TablePaginationState;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setPagination: (page: number, pageSize: number) => void;
  reload: () => void;
}

function emptyResult<T, TMeta>(pageSize: number): PaginatedResult<T, TMeta> {
  return {
    items: [],
    total: 0,
    page: 1,
    pageSize,
  };
}

function areDepsEqual(prev: DependencyList, next: DependencyList) {
  if (prev.length !== next.length) return false;
  return prev.every((value, index) => Object.is(value, next[index]));
}

export function usePaginatedList<T, TMeta = unknown>({
  fetcher,
  pageSize: initialPageSize = DEFAULT_TABLE_PAGE_SIZE,
  deps = [],
  enabled = true,
  clearOnError = false,
  onError,
  onSuccess,
}: UsePaginatedListOptions<T, TMeta>): UsePaginatedListResult<T, TMeta> {
  const [pageState, setPageState] = useState<PageState>({
    page: 1,
    pageSize: initialPageSize,
  });
  const [data, setData] = useState<PaginatedResult<T, TMeta>>(() =>
    emptyResult<T, TMeta>(initialPageSize),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [queryVersion, setQueryVersion] = useState(0);
  const [reloadVersion, setReloadVersion] = useState(0);
  const requestIdRef = useRef(0);
  const didMountRef = useRef(false);
  const depsRef = useRef<DependencyList>(deps);
  const fetcherRef = useRef(fetcher);
  const onErrorRef = useRef(onError);
  const onSuccessRef = useRef(onSuccess);

  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      depsRef.current = deps;
      return;
    }

    if (areDepsEqual(depsRef.current, deps)) return;
    depsRef.current = deps;

    setPageState((prev) => (prev.page === 1 ? prev : { ...prev, page: 1 }));
    setQueryVersion((value) => value + 1);
  }, [deps, pageState.page]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }

    let active = true;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setLoading(true);
    setError(null);

    fetcherRef
      .current({ page: pageState.page, pageSize: pageState.pageSize })
      .then((result) => {
        if (!active || requestId !== requestIdRef.current) return;
        setData({
          items: result.items,
          total: Number.isFinite(result.total) ? result.total : 0,
          page: result.page ?? pageState.page,
          pageSize: result.pageSize ?? pageState.pageSize,
          totalPages: result.totalPages,
          meta: result.meta,
        });
        onSuccessRef.current?.(result);
      })
      .catch((err: unknown) => {
        if (!active || requestId !== requestIdRef.current) return;
        setError(err);
        if (clearOnError) {
          setData(emptyResult<T, TMeta>(pageState.pageSize));
        }
        onErrorRef.current?.(err);
      })
      .finally(() => {
        if (!active || requestId !== requestIdRef.current) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    clearOnError,
    enabled,
    pageState.page,
    pageState.pageSize,
    queryVersion,
    reloadVersion,
  ]);

  const setPage = useCallback((page: number) => {
    setPageState((prev) => (prev.page === page ? prev : { ...prev, page }));
  }, []);

  const setPageSize = useCallback((pageSize: number) => {
    setPageState((prev) =>
      prev.page === 1 && prev.pageSize === pageSize
        ? prev
        : { page: 1, pageSize },
    );
  }, []);

  const setPagination = useCallback((page: number, pageSize: number) => {
    setPageState((prev) => {
      const nextPageSize = pageSize || prev.pageSize;
      const nextPage = nextPageSize === prev.pageSize ? page : 1;
      if (prev.page === nextPage && prev.pageSize === nextPageSize) {
        return prev;
      }
      return { page: nextPage, pageSize: nextPageSize };
    });
  }, []);

  const reload = useCallback(() => {
    setReloadVersion((value) => value + 1);
  }, []);

  const tablePagination = useMemo<TablePaginationState>(
    () => ({
      current: pageState.page,
      total: data.total,
      pageSize: pageState.pageSize,
      onChange: setPagination,
    }),
    [data.total, pageState.page, pageState.pageSize, setPagination],
  );

  return {
    items: data.items,
    total: data.total,
    page: pageState.page,
    pageSize: pageState.pageSize,
    loading,
    error,
    data,
    tablePagination,
    setPage,
    setPageSize,
    setPagination,
    reload,
  };
}
