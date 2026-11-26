import { useCallback, useEffect, useMemo, useRef, useState, type Key, type ReactNode } from 'react';
import {
  Button,
  DatePicker,
  Input,
  Popconfirm,
  Select,
  Space,
  Switch,
  message,
} from 'antd';
import {
  DownloadOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  PageHeader,
  StatCard,
  StatCardGroup,
  FilterBar,
  DataTable,
  DetailDrawer,
  EmptyPlaceholder,
  Tag,
} from '../../components/common';
import { apiKeyAdminApi, type AdminApiKeyRow } from '../../api/admin';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { usePermission } from '../../hooks/usePermission';
import { formatCurrencyCents } from '../../utils/price';

const STATUS_OPTIONS = [
  { label: '全部状态', value: 'all' },
  { label: '启用', value: 'active' },
  { label: '停用', value: 'inactive' },
];

function maskPrefix(prefix: string): string {
  if (!prefix) return '—';
  if (prefix.length <= 16) return prefix;
  return `${prefix.slice(0, 12)}...${prefix.slice(-4)}`;
}

export default function ApiKeysPage() {
  const canManage = usePermission('admin.page.api_keys.manage');
  const platformCurrency = usePlatformCurrency();
  const [search, setSearch] = useState('');
  const [emailFilter, setEmailFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateRange, setDateRange] = useState<
    [dayjs.Dayjs | null, dayjs.Dayjs | null] | null
  >(null);
  const [activeRow, setActiveRow] = useState<AdminApiKeyRow | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [dateFilteredRows, setDateFilteredRows] = useState<AdminApiKeyRow[] | null>(null);
  const [dateFilterLoading, setDateFilterLoading] = useState(false);
  const dateFilterRequestRef = useRef(0);

  const formatMoney = useCallback(
    (cents: number | null | undefined): string =>
      formatCurrencyCents(cents, platformCurrency, { zeroAsEmpty: true }),
    [platformCurrency],
  );

  const apiKeys = usePaginatedList<AdminApiKeyRow>({
    pageSize: 50,
    deps: [search, emailFilter, statusFilter],
    onError: () => message.error('加载 API Key 失败'),
    fetcher: useCallback(async ({ page, pageSize }) => {
      const res = await apiKeyAdminApi.list({
        page,
        pageSize,
        search: search || undefined,
        email: emailFilter || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter,
      });
      return {
        items: res.items || [],
        total: res.total || 0,
        page,
        pageSize,
      };
    }, [emailFilter, search, statusFilter]),
  });

  useEffect(() => {
    setSelectedRowKeys([]);
  }, [apiKeys.page, apiKeys.pageSize, dateRange, emailFilter, search, statusFilter]);

  useEffect(() => {
    if (!dateRange?.[0] || !dateRange?.[1]) {
      setDateFilteredRows(null);
      setDateFilterLoading(false);
      return undefined;
    }
    const range = dateRange;
    const requestId = dateFilterRequestRef.current + 1;
    dateFilterRequestRef.current = requestId;
    setDateFilterLoading(true);
    apiKeyAdminApi
      .listAll({
        search: search || undefined,
        email: emailFilter || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter,
      })
      .then((rows) => {
        if (requestId !== dateFilterRequestRef.current) return;
        const [start, end] = range;
        if (!start || !end) return;
        setDateFilteredRows(rows.filter((row) => {
          const created = dayjs(row.createdAt);
          return !created.isBefore(start.startOf('day')) && !created.isAfter(end.endOf('day'));
        }));
      })
      .catch(() => {
        if (requestId === dateFilterRequestRef.current) setDateFilteredRows([]);
      })
      .finally(() => {
        if (requestId === dateFilterRequestRef.current) setDateFilterLoading(false);
      });
    return undefined;
  }, [dateRange, emailFilter, search, statusFilter]);

  const filteredRows = useMemo(() => {
    if (dateRange?.[0] && dateRange?.[1]) return dateFilteredRows ?? [];
    return apiKeys.items;
  }, [apiKeys.items, dateFilteredRows, dateRange]);

  const stats = useMemo(() => {
    return {
      active: apiKeys.items.filter((r) => r.isActive).length,
      used30d: apiKeys.items.filter(
        (r) => r.lastUsedAt && dayjs().diff(dayjs(r.lastUsedAt), 'day') <= 30,
      ).length,
      monthlyCalls: apiKeys.items.reduce((sum, r) => sum + (r.monthlyCalls || 0), 0),
      monthlyCost: apiKeys.items.reduce((sum, r) => sum + (r.monthlyCost || 0), 0),
    };
  }, [apiKeys.items]);

  const handleExport = () => {
    const header = ['prefix', 'name', 'accountName', 'tenantId', 'creatorEmail', 'productName', 'isActive', 'monthlyCalls', 'monthlyCost', 'createdAt', 'lastUsedAt'];
    const lines = filteredRows.map((row) => [
      row.prefix,
      row.name,
      row.accountName ?? row.tenantName ?? row.userEmail,
      row.tenantId ?? '',
      row.userEmail,
      row.productName,
      row.isActive ? 'active' : 'inactive',
      row.monthlyCalls,
      row.monthlyCost,
      row.createdAt,
      row.lastUsedAt || '',
    ].map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[header.join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `api-keys-${dayjs().format('YYYYMMDD-HHmm')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleToggle = async (row: AdminApiKeyRow, isActive: boolean) => {
    try {
      await apiKeyAdminApi.toggle(row.id, isActive);
      message.success(isActive ? '已启用' : '已停用');
      setActiveRow((prev) => prev?.id === row.id ? { ...prev, isActive } : prev);
      apiKeys.reload();
    } catch {
      message.error('状态更新失败');
    }
  };

  const handleRevoke = async (ids: string[]) => {
    try {
      await Promise.all(ids.map((id) => apiKeyAdminApi.revoke(id)));
      message.success(ids.length > 1 ? `已吊销 ${ids.length} 个 Key` : '已吊销');
      setSelectedRowKeys([]);
      setActiveRow(null);
      apiKeys.reload();
    } catch {
      message.error('吊销失败');
    }
  };

  const columns = [
    {
      title: 'Key',
      key: 'prefix',
      render: (_: unknown, r: AdminApiKeyRow) => (
        <div>
          <div style={{ fontFamily: 'monospace' }}>{maskPrefix(r.fullPrefix || r.prefix)}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{r.name || '未命名 Key'}</div>
        </div>
      ),
    },
    {
      title: '产品账号',
      key: 'account',
      render: (_: unknown, row: AdminApiKeyRow) => (
        <div>
          <div>{row.accountName || row.tenantName || row.userEmail || '—'}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
            创建人 {row.userEmail || row.userId}
            {row.tenantType ? ` · ${row.tenantType}` : ''}
          </div>
        </div>
      ),
    },
    {
      title: '关联产品',
      dataIndex: 'productName',
      key: 'productName',
      render: (v: string) => v || '—',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—'),
    },
    {
      title: '最近使用',
      dataIndex: 'lastUsedAt',
      key: 'lastUsedAt',
      render: (v?: string | null) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—'),
    },
    {
      title: '本月调用',
      dataIndex: 'monthlyCalls',
      key: 'monthlyCalls',
      align: 'right' as const,
      render: (v?: number) => (v ? v.toLocaleString() : '—'),
    },
    {
      title: '本月费用',
      dataIndex: 'monthlyCost',
      key: 'monthlyCost',
      align: 'right' as const,
      render: (v?: number) => formatMoney(v),
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      key: 'isActive',
      render: (v: boolean) =>
        v ? <Tag variant="success">启用</Tag> : <Tag>停用</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 190,
      align: 'right' as const,
      render: (_: unknown, r: AdminApiKeyRow) => (
        <Space size={4} onClick={(e) => e.stopPropagation()}>
          <Button type="link" size="small" onClick={() => setActiveRow(r)}>
            详情
          </Button>
          <Switch
            size="small"
            checked={r.isActive}
            disabled={!canManage}
            onChange={(checked) => handleToggle(r, checked)}
          />
          <Popconfirm
            title="确认吊销此 API Key？"
            okText="吊销"
            cancelText="取消"
            onConfirm={() => handleRevoke([r.id])}
            disabled={!canManage}
          >
            <Button type="link" size="small" danger disabled={!canManage}>
              吊销
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const drawerTabs = activeRow
    ? [
        {
          key: 'basic',
          label: '基本信息',
          content: (
            <div style={{ display: 'grid', gap: 12 }}>
              <DetailRow label="名称" value={activeRow.name || '—'} />
              <DetailRow label="Prefix" value={<span style={{ fontFamily: 'monospace' }}>{activeRow.prefix}</span>} />
              <DetailRow
                label="产品账号"
                value={activeRow.accountName || activeRow.tenantName || activeRow.tenantId || '—'}
              />
              <DetailRow
                label="创建身份"
                value={<a href={`/users/${activeRow.userId}`}>{activeRow.userEmail || activeRow.userId}</a>}
              />
              <DetailRow label="关联产品" value={activeRow.productName || '—'} />
              <DetailRow
                label="允许模型"
                value={
                  activeRow.allowedModels && activeRow.allowedModels.length > 0 ? (
                    <Space wrap>
                      {activeRow.allowedModels.map((model) => (
                        <Tag key={model}>{model}</Tag>
                      ))}
                    </Space>
                  ) : (
                    '继承套餐模型'
                  )
                }
              />
              <DetailRow label="创建时间" value={dayjs(activeRow.createdAt).format('YYYY-MM-DD HH:mm')} />
              <DetailRow
                label="最近使用"
                value={activeRow.lastUsedAt ? dayjs(activeRow.lastUsedAt).format('YYYY-MM-DD HH:mm') : '—'}
              />
              <DetailRow label="本月调用" value={activeRow.monthlyCalls.toLocaleString()} />
              <DetailRow label="本月费用" value={formatMoney(activeRow.monthlyCost)} />
            </div>
          ),
        },
      ]
    : [];

  return (
    <div>
      <PageHeader
        title="按量账号管理"
        subtitle="按账号和产品查看 API Key、定位异常调用，并在必要时停用或吊销"
        actions={[
          <Button key="refresh" onClick={apiKeys.reload}>
            刷新
          </Button>,
          <Button key="export" icon={<DownloadOutlined />} onClick={handleExport}>
            导出当前结果
          </Button>,
          <Popconfirm
            key="revoke"
            title={`确认吊销选中的 ${selectedRowKeys.length} 个 API Key？`}
            okText="吊销"
            cancelText="取消"
            onConfirm={() => handleRevoke(selectedRowKeys.map(String))}
            disabled={!canManage || selectedRowKeys.length === 0}
          >
            <Button
              danger
              icon={<ExclamationCircleOutlined />}
              disabled={!canManage || selectedRowKeys.length === 0}
            >
              批量吊销
            </Button>
          </Popconfirm>,
        ]}
      />

      <StatCardGroup columns={5}>
        <StatCard label="当前结果" value={apiKeys.total} />
        <StatCard label="本页启用" value={stats.active} variant="success" />
        <StatCard label="30 天有调用" value={stats.used30d} />
        <StatCard label="本页月调用" value={stats.monthlyCalls.toLocaleString()} />
        <StatCard label="本页月费用" value={formatMoney(stats.monthlyCost)} />
      </StatCardGroup>

      <FilterBar
        search={{
          placeholder: '搜索 Prefix / Key 名 / 创建人邮箱',
          value: search,
          onSearch: (value) => {
            setSearch(value);
          },
        }}
        filters={[
          <Input
            key="email"
            placeholder="用户邮箱"
            allowClear
            style={{ width: 220 }}
            value={emailFilter}
            onChange={(e) => {
              setEmailFilter(e.target.value);
            }}
          />,
          <Select
            key="status"
            value={statusFilter}
            style={{ width: 130 }}
            onChange={(value) => {
              setStatusFilter(value);
            }}
            options={STATUS_OPTIONS}
          />,
          <DatePicker.RangePicker
            key="range"
            value={dateRange ?? undefined}
            onChange={(range) => setDateRange(range as [dayjs.Dayjs | null, dayjs.Dayjs | null] | null)}
          />,
        ]}
      />

      {filteredRows.length === 0 && !apiKeys.loading && !dateFilterLoading ? (
        <EmptyPlaceholder
          title="暂无 API Key"
          description={apiKeys.items.length === 0 ? '当前筛选条件下没有 API Key。' : '当前日期范围内没有匹配记录。'}
        />
      ) : (
        <DataTable<AdminApiKeyRow>
          rowKey="id"
          columns={columns}
          dataSource={filteredRows}
          loading={apiKeys.loading || dateFilterLoading}
          pagination={dateRange?.[0] && dateRange?.[1] ? { pageSize: 50 } : undefined}
          listPagination={dateRange?.[0] && dateRange?.[1] ? undefined : apiKeys.tablePagination}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
            getCheckboxProps: () => ({ disabled: !canManage }),
          }}
          scroll={{ x: 1200 }}
          onRowClick={(row) => setActiveRow(row)}
        />
      )}

      <DetailDrawer
        open={!!activeRow}
        onClose={() => setActiveRow(null)}
        title={activeRow?.name || activeRow?.prefix || ''}
        subtitle={activeRow?.userEmail}
        status={
          activeRow ? (
            activeRow.isActive ? (
              <Tag variant="success">启用</Tag>
            ) : (
              <Tag>停用</Tag>
            )
          ) : null
        }
        tabs={drawerTabs}
        actions={
          activeRow ? (
            <Space>
              <Button onClick={() => setActiveRow(null)}>关闭</Button>
              <Button
                onClick={() => handleToggle(activeRow, !activeRow.isActive)}
                disabled={!canManage}
              >
                {activeRow.isActive ? '停用' : '启用'}
              </Button>
              <Popconfirm
                title="确认吊销此 API Key？"
                okText="吊销"
                cancelText="取消"
                onConfirm={() => handleRevoke([activeRow.id])}
                disabled={!canManage}
              >
                <Button danger disabled={!canManage}>吊销</Button>
              </Popconfirm>
            </Space>
          ) : null
        }
        width={560}
      />
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
      <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
