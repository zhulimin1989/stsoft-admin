import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, DatePicker, Form, Input, Modal, Popconfirm, Select, Space, Switch, message } from 'antd';
import { DownloadOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import {
  PageHeader,
  StatCard,
  StatCardGroup,
  FilterBar,
  DataTable,
  DetailDrawer,
  EmptyPlaceholder,
  StableNumberInput,
  Tag,
} from '../../components/common';
import {
  apiKeyAdminApi,
  paygAccountAdminApi,
  type AdminPaygAccountKeyRow,
  type AdminPaygAccountRow,
} from '../../api/admin';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { usePermission } from '../../hooks/usePermission';
import { currencyMinorUnitLabel, formatCurrencyCents } from '../../utils/price';

const STATUS_OPTIONS = [
  { label: '全部状态', value: 'all' },
  { label: '有启用 Key', value: 'active' },
  { label: '无启用 Key', value: 'inactive' },
];

type VoucherFormValues = {
  amountCents?: number;
  reason?: string;
  expiresAt?: Dayjs | null;
};

interface PaygAccountStats {
  active: number;
  activeKeys: number;
  monthlyCalls: number;
  monthlyCost: number;
}

interface PaygAccountListMeta {
  stats: PaygAccountStats;
}

function createAdminIdempotencyKey(scope: string, subjectId: string): string {
  const randomId = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `admin:${scope}:${subjectId}:${randomId}`;
}

function maskPrefix(prefix: string): string {
  if (!prefix) return '—';
  if (prefix.length <= 16) return prefix;
  return `${prefix.slice(0, 12)}...${prefix.slice(-4)}`;
}

export default function PaygAccountsPage() {
  const canManage = usePermission('admin.page.payg_accounts.manage');
  const platformCurrency = usePlatformCurrency();
  const [voucherForm] = Form.useForm<VoucherFormValues>();
  const [searchParams] = useSearchParams();
  const emailParam = searchParams.get('email') ?? '';
  const [search, setSearch] = useState('');
  const [emailFilter, setEmailFilter] = useState(emailParam);
  const [statusFilter, setStatusFilter] = useState('all');
  const [activeRow, setActiveRow] = useState<AdminPaygAccountRow | null>(null);
  const [voucherRow, setVoucherRow] = useState<AdminPaygAccountRow | null>(null);
  const [voucherIdempotencyKey, setVoucherIdempotencyKey] = useState<string | null>(null);
  const [voucherSubmitting, setVoucherSubmitting] = useState(false);
  const [stats, setStats] = useState<PaygAccountStats>({
    active: 0,
    activeKeys: 0,
    monthlyCalls: 0,
    monthlyCost: 0,
  });
  const voucherAmountCents = Form.useWatch('amountCents', voucherForm) ?? 0;
  const minorUnitLabel = currencyMinorUnitLabel(platformCurrency);
  const formatMoney = useCallback(
    (cents: number | null | undefined): string =>
      formatCurrencyCents(cents, platformCurrency),
    [platformCurrency],
  );

  const paygAccounts = usePaginatedList<AdminPaygAccountRow, PaygAccountListMeta>({
    pageSize: 50,
    deps: [search, emailFilter, statusFilter],
    onError: () => message.error('加载按量账号失败'),
    onSuccess: ({ meta }) => {
      if (meta) setStats(meta.stats);
    },
    fetcher: useCallback(async ({ page, pageSize }) => {
      const res = await paygAccountAdminApi.list({
        page,
        pageSize,
        search: search || undefined,
        email: emailFilter || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter,
      });
      const nextStats = res.stats || { active: 0, activeKeys: 0, monthlyCalls: 0, monthlyCost: 0 };
      return {
        items: res.items || [],
        total: res.total || 0,
        page,
        pageSize,
        meta: { stats: nextStats },
      };
    }, [emailFilter, search, statusFilter]),
  });

  useEffect(() => {
    setEmailFilter(emailParam);
  }, [emailParam]);

  const handleExport = () => {
    const header = [
      'accountName',
      'tenantId',
      'productName',
      'productSlug',
      'creatorEmail',
      'keyCount',
      'activeKeyCount',
      'walletBalanceCents',
      'monthlyCalls',
      'monthlyCost',
      'lastUsedAt',
    ];
    const lines = paygAccounts.items.map((row) => [
      row.accountName || row.tenantName || '',
      row.tenantId,
      row.productName,
      row.productSlug || '',
      row.userEmail,
      row.keyCount,
      row.activeKeyCount,
      row.walletBalanceCents,
      row.monthlyCalls,
      row.monthlyCost,
      row.lastUsedAt || '',
    ].map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[header.join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `payg-accounts-${dayjs().format('YYYYMMDD-HHmm')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleToggleKey = useCallback(async (key: AdminPaygAccountKeyRow, isActive: boolean) => {
    try {
      await apiKeyAdminApi.toggle(key.id, isActive);
      message.success(isActive ? '已启用' : '已停用');
      paygAccounts.reload();
      setActiveRow((prev) => refreshActiveRow(prev, key.id, { isActive }));
    } catch {
      message.error('状态更新失败');
    }
  }, [paygAccounts]);

  const handleRevokeKey = useCallback(async (key: AdminPaygAccountKeyRow) => {
    try {
      await apiKeyAdminApi.revoke(key.id);
      message.success('已吊销');
      paygAccounts.reload();
      setActiveRow((prev) => refreshActiveRow(prev, key.id, null));
    } catch {
      message.error('吊销失败');
    }
  }, [paygAccounts]);

  const openVoucherModal = useCallback((row: AdminPaygAccountRow) => {
    setVoucherRow(row);
    setVoucherIdempotencyKey(createAdminIdempotencyKey('payg-voucher', row.tenantId));
    voucherForm.setFieldsValue({
      amountCents: 1000,
      reason: '',
      expiresAt: dayjs().add(30, 'day'),
    });
  }, [voucherForm]);

  const closeVoucherModal = useCallback(() => {
    if (voucherSubmitting) return;
    setVoucherRow(null);
    setVoucherIdempotencyKey(null);
    voucherForm.resetFields();
  }, [voucherForm, voucherSubmitting]);

  const handleIssueVoucher = useCallback(async () => {
    if (!voucherRow) return;
    try {
      const values = await voucherForm.validateFields();
      const amountCents = Number(values.amountCents || 0);
      const idempotencyKey = voucherIdempotencyKey
        ?? createAdminIdempotencyKey('payg-voucher', voucherRow.tenantId);
      if (!voucherIdempotencyKey) setVoucherIdempotencyKey(idempotencyKey);
      setVoucherSubmitting(true);
      await paygAccountAdminApi.issueVoucher(voucherRow.tenantId, {
        userId: voucherRow.userId,
        productId: voucherRow.productId ?? null,
        amountCents,
        reason: values.reason?.trim() || '',
        expiresAt: values.expiresAt ? values.expiresAt.format('YYYY-MM-DD') : null,
        idempotencyKey,
      });
      message.success('代金券已发放');
      setActiveRow((prev) => prev && prev.id === voucherRow.id
        ? { ...prev, walletBalanceCents: prev.walletBalanceCents + amountCents }
        : prev);
      setVoucherRow(null);
      setVoucherIdempotencyKey(null);
      voucherForm.resetFields();
      paygAccounts.reload();
    } catch (error) {
      if ((error as { errorFields?: unknown[] })?.errorFields) return;
      message.error(getErrorMessage(error, '代金券发放失败'));
    } finally {
      setVoucherSubmitting(false);
    }
  }, [paygAccounts, voucherForm, voucherIdempotencyKey, voucherRow]);

  const columns = [
    {
      title: '产品账号',
      key: 'account',
      render: (_: unknown, row: AdminPaygAccountRow) => (
        <div>
          <div>{row.accountName || row.tenantName || row.userEmail}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
            创建人 {row.userEmail || row.userId}
            {row.tenantType ? ` · ${row.tenantType}` : ''}
          </div>
        </div>
      ),
    },
    {
      title: '产品',
      key: 'product',
      render: (_: unknown, row: AdminPaygAccountRow) => (
        <div>
          <div>{row.productName}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{row.productSlug || row.productId || '—'}</div>
        </div>
      ),
    },
    {
      title: '钱包余额',
      dataIndex: 'walletBalanceCents',
      key: 'walletBalanceCents',
      width: 130,
      align: 'right' as const,
      render: (value: number) => formatMoney(value),
    },
    {
      title: 'API Key',
      key: 'keys',
      width: 120,
      align: 'right' as const,
      render: (_: unknown, row: AdminPaygAccountRow) => `${row.activeKeyCount}/${row.keyCount}`,
    },
    {
      title: '本月调用',
      dataIndex: 'monthlyCalls',
      key: 'monthlyCalls',
      width: 120,
      align: 'right' as const,
      render: (value: number) => value.toLocaleString(),
    },
    {
      title: '本月费用',
      dataIndex: 'monthlyCost',
      key: 'monthlyCost',
      width: 120,
      align: 'right' as const,
      render: (value: number) => formatMoney(value),
    },
    {
      title: '最近使用',
      dataIndex: 'lastUsedAt',
      key: 'lastUsedAt',
      width: 160,
      render: (value?: string | null) => value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—',
    },
    {
      title: '状态',
      key: 'status',
      width: 100,
      render: (_: unknown, row: AdminPaygAccountRow) =>
        row.activeKeyCount > 0 ? <Tag variant="success">可用</Tag> : <Tag variant="warn">无启用 Key</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 130,
      align: 'right' as const,
      render: (_: unknown, row: AdminPaygAccountRow) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            onClick={(event) => {
              event.stopPropagation();
              setActiveRow(row);
            }}
          >
            详情
          </Button>
          <Button
            type="link"
            size="small"
            disabled={!canManage}
            onClick={(event) => {
              event.stopPropagation();
              openVoucherModal(row);
            }}
          >
            发券
          </Button>
        </Space>
      ),
    },
  ];

  const keyColumns = useMemo(() => [
    {
      title: 'Key',
      key: 'key',
      width: 260,
      render: (_: unknown, key: AdminPaygAccountKeyRow) => (
        <div>
          <div style={{ fontFamily: 'monospace' }}>{maskPrefix(key.prefix)}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{key.name || '未命名 Key'}</div>
        </div>
      ),
    },
    {
      title: '本月调用',
      dataIndex: 'monthlyCalls',
      key: 'monthlyCalls',
      width: 110,
      align: 'right' as const,
      render: (value: number) => value.toLocaleString(),
    },
    {
      title: '本月费用',
      dataIndex: 'monthlyCost',
      key: 'monthlyCost',
      width: 110,
      align: 'right' as const,
      render: (value: number) => formatMoney(value),
    },
    {
      title: '状态',
      key: 'status',
      width: 90,
      render: (_: unknown, key: AdminPaygAccountKeyRow) =>
        key.isActive ? <Tag variant="success">启用</Tag> : <Tag>停用</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 130,
      align: 'right' as const,
      render: (_: unknown, key: AdminPaygAccountKeyRow) => (
        <Space size={4}>
          <Switch
            size="small"
            checked={key.isActive}
            disabled={!canManage}
            onChange={(checked) => handleToggleKey(key, checked)}
          />
          <Popconfirm
            title="确认吊销此 API Key？"
            okText="吊销"
            cancelText="取消"
            onConfirm={() => handleRevokeKey(key)}
            disabled={!canManage}
          >
            <Button type="link" size="small" danger disabled={!canManage}>
              吊销
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ], [canManage, formatMoney, handleRevokeKey, handleToggleKey]);

  const drawerTabs = activeRow
    ? [
        {
          key: 'overview',
          label: '账号概览',
          content: (
            <div style={{ display: 'grid', gap: 12 }}>
              <DetailRow label="产品账号" value={activeRow.accountName || activeRow.tenantName || '—'} />
              <DetailRow label="Tenant ID" value={<span style={{ fontFamily: 'monospace' }}>{activeRow.tenantId}</span>} />
              <DetailRow label="产品" value={`${activeRow.productName}${activeRow.productSlug ? ` · ${activeRow.productSlug}` : ''}`} />
              <DetailRow label="创建身份" value={<a href={`/users/${activeRow.userId}`}>{activeRow.userEmail || activeRow.userId}</a>} />
              <DetailRow label="钱包余额" value={formatMoney(activeRow.walletBalanceCents)} />
              <DetailRow label="API Key" value={`${activeRow.activeKeyCount}/${activeRow.keyCount} 启用`} />
              <DetailRow label="本月调用" value={activeRow.monthlyCalls.toLocaleString()} />
              <DetailRow label="本月费用" value={formatMoney(activeRow.monthlyCost)} />
              <DetailRow label="最近使用" value={activeRow.lastUsedAt ? dayjs(activeRow.lastUsedAt).format('YYYY-MM-DD HH:mm') : '—'} />
            </div>
          ),
        },
        {
          key: 'keys',
          label: '关联 Key',
          content: (
            <DataTable<AdminPaygAccountKeyRow>
              rowKey="id"
              columns={keyColumns}
              dataSource={activeRow.keys || []}
              pagination={false}
              scroll={{ x: 700 }}
            />
          ),
        },
      ]
    : [];

  return (
    <div>
      <PageHeader
        title="按量账号管理"
        subtitle="按账号和产品聚合钱包、API Key、月调用和费用"
        actions={[
          <Button key="refresh" onClick={paygAccounts.reload}>
            刷新
          </Button>,
          <Button key="export" icon={<DownloadOutlined />} onClick={handleExport}>
            导出当前结果
          </Button>,
        ]}
      />

      <StatCardGroup columns={5}>
        <StatCard label="按量账号" value={paygAccounts.total} />
        <StatCard label="可用账号" value={stats.active} variant="success" />
        <StatCard label="启用 Key" value={stats.activeKeys} />
        <StatCard label="本月调用" value={stats.monthlyCalls.toLocaleString()} />
        <StatCard label="本月费用" value={formatMoney(stats.monthlyCost)} />
      </StatCardGroup>

      <FilterBar
        search={{
          placeholder: '搜索账号 / Key / 创建人邮箱',
          value: search,
          onSearch: (value) => {
            setSearch(value);
          },
        }}
        filters={[
          <Input
            key="email"
            placeholder="创建人邮箱"
            allowClear
            style={{ width: 220 }}
            value={emailFilter}
            onChange={(event) => {
              setEmailFilter(event.target.value);
            }}
          />,
          <Select
            key="status"
            value={statusFilter}
            style={{ width: 140 }}
            onChange={(value) => {
              setStatusFilter(value);
            }}
            options={STATUS_OPTIONS}
          />,
        ]}
      />

      {paygAccounts.items.length === 0 && !paygAccounts.loading ? (
        <EmptyPlaceholder
          title="暂无按量账号"
          description="当前筛选条件下没有按量型产品账号。"
        />
      ) : (
        <DataTable<AdminPaygAccountRow>
          rowKey="id"
          columns={columns}
          dataSource={paygAccounts.items}
          loading={paygAccounts.loading}
          listPagination={paygAccounts.tablePagination}
          scroll={{ x: 1100 }}
          onRowClick={(row) => setActiveRow(row)}
        />
      )}

      <DetailDrawer
        open={!!activeRow}
        onClose={() => setActiveRow(null)}
        title={activeRow?.accountName || activeRow?.tenantName || ''}
        subtitle={activeRow?.productName}
        status={
          activeRow ? (
            activeRow.activeKeyCount > 0 ? (
              <Tag variant="success">可用</Tag>
            ) : (
              <Tag variant="warn">无启用 Key</Tag>
            )
          ) : null
        }
        tabs={drawerTabs}
        actions={activeRow ? (
          <Space>
            <Button onClick={() => setActiveRow(null)}>关闭</Button>
            <Button disabled={!canManage} onClick={() => openVoucherModal(activeRow)}>
              发放代金券
            </Button>
            {activeRow.activeKeyCount === 0 ? null : (
              <Popconfirm
                title={`确认吊销此账号下的 ${activeRow.activeKeyCount} 个启用 Key？`}
                okText="吊销"
                cancelText="取消"
                onConfirm={async () => {
                  const activeKeys = activeRow.keys.filter((key) => key.isActive);
                  try {
                    await Promise.all(activeKeys.map((key) => apiKeyAdminApi.revoke(key.id)));
                    message.success(`已吊销 ${activeKeys.length} 个 Key`);
                    setActiveRow(null);
                    paygAccounts.reload();
                  } catch {
                    message.error('批量吊销失败');
                  }
                }}
                disabled={!canManage}
              >
                <Button danger icon={<ExclamationCircleOutlined />} disabled={!canManage}>
                  吊销启用 Key
                </Button>
              </Popconfirm>
            )}
          </Space>
        ) : null}
        width={820}
      />

      <Modal
        open={!!voucherRow}
        title="发放代金券"
        okText="确认发放"
        cancelText="取消"
        confirmLoading={voucherSubmitting}
        onOk={handleIssueVoucher}
        onCancel={closeVoucherModal}
        destroyOnHidden
      >
        {voucherRow ? (
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'grid', gap: 8, color: 'var(--text-secondary)' }}>
              <DetailRow label="目标账号" value={voucherRow.accountName || voucherRow.tenantName || voucherRow.userEmail} />
              <DetailRow label="创建身份" value={voucherRow.userEmail || voucherRow.userId} />
              <DetailRow label="产品" value={`${voucherRow.productName}${voucherRow.productSlug ? ` · ${voucherRow.productSlug}` : ''}`} />
              <DetailRow label="当前余额" value={formatMoney(voucherRow.walletBalanceCents)} />
            </div>
            <Form<VoucherFormValues> form={voucherForm} layout="vertical">
              <Form.Item
                label={`代金券金额（${minorUnitLabel}）`}
                name="amountCents"
                rules={[
                  { required: true, message: '请输入代金券金额' },
                  {
                    validator: (_, value) => {
                      if (Number.isInteger(value) && value > 0 && value <= 2_500_000) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error('请输入 1 到 2,500,000 之间的整数分值'));
                    },
                  },
                ]}
                extra={`将发放 ${formatMoney(Number(voucherAmountCents || 0))} 代金券余额`}
              >
                <StableNumberInput min={1} max={2_500_000} precision={0} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item
                label="发放原因"
                name="reason"
                rules={[
                  { required: true, message: '请输入发放原因' },
                  {
                    validator: (_, value) => value?.trim()
                      ? Promise.resolve()
                      : Promise.reject(new Error('发放原因不能为空')),
                  },
                ]}
              >
                <Input.TextArea rows={3} maxLength={200} showCount placeholder="例如：客服补偿 / 活动代金券" />
              </Form.Item>
              <Form.Item label="过期时间" name="expiresAt">
                <DatePicker
                  allowClear
                  style={{ width: '100%' }}
                  disabledDate={(date) => !!date && date.endOf('day').isBefore(dayjs())}
                />
              </Form.Item>
            </Form>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function refreshActiveRow(
  row: AdminPaygAccountRow | null,
  keyId: string,
  patch: Partial<AdminPaygAccountKeyRow> | null,
): AdminPaygAccountRow | null {
  if (!row) return row;
  const keys = patch
    ? row.keys.map((key) => key.id === keyId ? { ...key, ...patch } : key)
    : row.keys.filter((key) => key.id !== keyId);
  return {
    ...row,
    keys,
    keyCount: keys.length,
    activeKeyCount: keys.filter((key) => key.isActive).length,
  };
}

function getErrorMessage(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: { message?: unknown } } })?.response?.data;
  return typeof data?.message === 'string' && data.message.trim() ? data.message : fallback;
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
