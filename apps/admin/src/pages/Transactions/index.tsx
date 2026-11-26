import { useCallback, useEffect, useRef, useState } from 'react';
import { Tag } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { transactionApi } from '../../api/admin';
import { DataTable } from '../../components/common';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { formatCurrencyCents } from '../../utils/price';

interface TransactionRow {
  id: string;
  type?: string;
  user?: {
    email?: string | null;
  } | null;
  amountCents?: number;
  balanceAfterCents?: number;
  tokenUsageId?: string | null;
  description?: string | null;
  createdAt?: string;
}

export default function TransactionsPage() {
  const [searchParams] = useSearchParams();
  const platformCurrency = usePlatformCurrency();
  const userIdFilter = searchParams.get('userId') ?? '';
  const [search, setSearch] = useState('');
  const [searchRows, setSearchRows] = useState<TransactionRow[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchRequestRef = useRef(0);
  const transactions = usePaginatedList<TransactionRow>({
    fetcher: useCallback(async ({ page, pageSize }) => {
      const res = await transactionApi.list({
        page,
        pageSize,
        userId: userIdFilter || undefined,
      });
      return {
        items: (res?.items ?? []) as TransactionRow[],
        total: Number(res?.total ?? 0),
        page,
        pageSize,
      };
    }, [userIdFilter]),
    deps: [userIdFilter],
    clearOnError: true,
  });
  const isSearchMode = search.trim().length > 0;

  useEffect(() => {
    const query = search.trim();
    if (!query) {
      setSearchRows([]);
      setSearchLoading(false);
      return undefined;
    }
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      transactionApi
        .listAll<TransactionRow>({ userId: userIdFilter || undefined })
        .then((rows) => {
          if (requestId === searchRequestRef.current) setSearchRows(rows);
        })
        .catch(() => {
          if (requestId === searchRequestRef.current) setSearchRows([]);
        })
        .finally(() => {
          if (requestId === searchRequestRef.current) setSearchLoading(false);
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, userIdFilter]);

  const typeColors: Record<string, string> = {
    RECHARGE: 'green',
    CONSUME: 'orange',
    ADJUST: 'blue',
    REFUND: 'purple',
  };

  const formatSignedAmount = (value: number, type?: string) => {
    const prefix = type === 'CONSUME' ? '' : value > 0 ? '+' : '';
    return `${prefix}${formatCurrencyCents(Math.abs(value), platformCurrency)}`;
  };

  const columns = [
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (t: string) => <Tag color={typeColors[t] || 'default'}>{t}</Tag>,
    },
    { title: '用户', dataIndex: ['user', 'email'], key: 'email' },
    {
      title: '金额',
      dataIndex: 'amountCents',
      key: 'amountCents',
      render: (v: number | undefined, row: { type?: string }) => (
        <span
          style={{
            color: row.type === 'CONSUME' ? '#f97316' : (v ?? 0) > 0 ? '#10b981' : '#ef4444',
            fontWeight: 500,
          }}
        >
          {formatSignedAmount(v ?? 0, row.type)}
        </span>
      ),
    },
    {
      title: '余额',
      dataIndex: 'balanceAfterCents',
      key: 'balanceAfterCents',
      render: (v?: number) => formatCurrencyCents(v ?? 0, platformCurrency),
    },
    {
      title: '关联用量ID',
      dataIndex: 'tokenUsageId',
      key: 'tokenUsageId',
      render: (v: string | null) => v ? <span style={{ fontFamily: 'monospace' }}>{v}</span> : '—',
    },
    { title: '说明', dataIndex: 'description', key: 'description', ellipsis: true },
    { title: '时间', dataIndex: 'createdAt', key: 'createdAt', render: (t?: string) => (t ? new Date(t).toLocaleString() : '—') },
  ];

  return (
    <div>
      <h2 style={{ marginBottom: 8, fontSize: 20, fontWeight: 600 }}>交易流水</h2>
      {userIdFilter && (
        <div style={{ marginBottom: 16, color: 'var(--text-muted)', fontSize: 13 }}>
          当前按用户 ID 过滤：{userIdFilter}
        </div>
      )}
      <DataTable<TransactionRow>
        columns={columns}
        dataSource={isSearchMode ? searchRows : transactions.items}
        rowKey="id"
        loading={isSearchMode ? searchLoading : transactions.loading}
        searchable
        searchPlaceholder="搜索用户 / 交易类型 / 流水 ID"
        onSearchChange={setSearch}
        pagination={isSearchMode ? { pageSize: 20 } : undefined}
        listPagination={isSearchMode ? undefined : transactions.tablePagination}
      />
    </div>
  );
}
