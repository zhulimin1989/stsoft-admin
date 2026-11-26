import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Form, Input, Modal, Select, Space, Tabs, message } from 'antd';
import dayjs from 'dayjs';
import {
  PageHeader,
  StatCard,
  StatCardGroup,
  FilterBar,
  DataTable,
  EmptyPlaceholder,
  StableNumberInput,
  Tag,
} from '../../components/common';
import { adminSubscriptionApi, productApi, type AdminSubscriptionRow } from '../../api/admin';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { usePermission } from '../../hooks/usePermission';
import { formatCurrencyCents } from '../../utils/price';

type TabKey = 'active' | 'expiring' | 'cancelled' | 'expired';

interface ProductOption {
  id: string;
  name: string;
  slug?: string;
}

interface GrantCreditsFormValues {
  amount?: number;
  reason?: string;
}

const EMPTY_STATS = {
  active: 0,
  expiringSoon: 0,
  cancelled: 0,
  expired: 0,
};

type SubscriptionStats = typeof EMPTY_STATS;

interface SubscriptionListMeta {
  stats: SubscriptionStats;
}

function createAdminIdempotencyKey(scope: string, subjectId: string): string {
  const randomId = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `admin:${scope}:${subjectId}:${randomId}`;
}

const STATUS_LABEL: Record<AdminSubscriptionRow['status'], { label: string; variant?: 'success' | 'warn' | 'muted' }> = {
  ACTIVE: { label: '生效中', variant: 'success' },
  CANCELLED: { label: '已取消', variant: 'warn' },
  EXPIRED: { label: '已过期', variant: 'muted' },
};

function getApiErrorMessage(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: { message?: unknown; error?: unknown } } })?.response?.data;
  if (typeof data?.message === 'string') return data.message;
  if (Array.isArray(data?.message)) return data.message.join('；');
  if (typeof data?.error === 'string') return data.error;
  return fallback;
}

export default function SubscriptionsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const platformCurrency = usePlatformCurrency();
  const userIdParam = searchParams.get('userId') ?? '';
  const [grantForm] = Form.useForm<GrantCreditsFormValues>();
  const canManage = usePermission('admin.page.subscription_accounts.manage');
  const [activeTab, setActiveTab] = useState<TabKey>('active');
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [productFilter, setProductFilter] = useState('all');
  const [userIdFilter, setUserIdFilter] = useState(userIdParam);
  const [grantRow, setGrantRow] = useState<AdminSubscriptionRow | null>(null);
  const [grantIdempotencyKey, setGrantIdempotencyKey] = useState<string | null>(null);
  const [granting, setGranting] = useState(false);
  const [grantValidationMessage, setGrantValidationMessage] = useState('');
  const [stats, setStats] = useState<SubscriptionStats>(EMPTY_STATS);

  const formatMoney = useCallback(
    (cents: number | null | undefined): string =>
      formatCurrencyCents(cents, platformCurrency, { zeroAsEmpty: true }),
    [platformCurrency],
  );

  const query = useMemo(() => {
    const productId = productFilter === 'all' ? undefined : productFilter;
    const userId = userIdFilter.trim() || undefined;
    if (activeTab === 'expiring') return { status: 'ACTIVE', expiringDays: 7, productId, userId };
    if (activeTab === 'cancelled') return { status: 'CANCELLED', productId, userId };
    if (activeTab === 'expired') return { status: 'EXPIRED', productId, userId };
    return { status: 'ACTIVE', productId, userId };
  }, [activeTab, productFilter, userIdFilter]);

  const subscriptions = usePaginatedList<AdminSubscriptionRow, SubscriptionListMeta>({
    pageSize: 50,
    deps: [query.status, query.expiringDays, query.productId, query.userId],
    onError: () => message.error('加载订阅数据失败'),
    onSuccess: ({ meta }) => {
      if (meta) setStats(meta.stats);
    },
    fetcher: useCallback(async ({ page, pageSize }) => {
      const res = await adminSubscriptionApi.list({
        ...query,
        page,
        pageSize,
      });
      const nextStats = res.stats || EMPTY_STATS;
      return {
        items: res.items || [],
        total: res.total || 0,
        page,
        pageSize,
        meta: { stats: nextStats },
      };
    }, [query]),
  });

  useEffect(() => {
    setUserIdFilter(userIdParam);
  }, [userIdParam]);

  useEffect(() => {
    productApi.list()
      .then((res) => setProducts(Array.isArray(res) ? res : res?.items || []))
      .catch(() => setProducts([]));
  }, []);

  const openGrantModal = (row: AdminSubscriptionRow) => {
    setGrantRow(row);
    setGrantIdempotencyKey(createAdminIdempotencyKey('subscription-grant', row.id));
    setGrantValidationMessage('');
    grantForm.resetFields();
  };

  const closeGrantModal = () => {
    setGrantRow(null);
    setGrantIdempotencyKey(null);
    setGrantValidationMessage('');
    grantForm.resetFields();
  };

  const handleGrantCredits = async () => {
    if (!grantRow) return;
    let values: GrantCreditsFormValues;
    try {
      values = await grantForm.validateFields();
    } catch {
      setGrantValidationMessage('请补全赠送信息后再确认');
      return;
    }
    const amount = Number(values.amount);
    const reason = values.reason?.trim() ?? '';
    const idempotencyKey = grantIdempotencyKey
      ?? createAdminIdempotencyKey('subscription-grant', grantRow.id);
    if (!grantIdempotencyKey) setGrantIdempotencyKey(idempotencyKey);
    setGrantValidationMessage('');
    setGranting(true);
    try {
      await adminSubscriptionApi.grantCredits(grantRow.id, amount, reason, idempotencyKey);
      message.success(`已向订阅账号赠送 ${amount} 积分`);
      closeGrantModal();
      subscriptions.reload();
    } catch (error) {
      message.error(getApiErrorMessage(error, '赠送积分失败'));
    } finally {
      setGranting(false);
    }
  };

  const columns = [
    {
      title: '账号 / 身份',
      key: 'account',
      render: (_: unknown, row: AdminSubscriptionRow) => (
        <div>
          <div>{row.accountName || row.tenantName || row.userEmail || row.userId}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
            创建人 {row.userEmail || row.userId}
            {row.tenantType ? ` · ${row.tenantType}` : ''}
          </div>
        </div>
      ),
    },
    {
      title: '产品 / 套餐',
      key: 'plan',
      render: (_: unknown, row: AdminSubscriptionRow) => (
        <div>
          <div style={{ fontWeight: 500 }}>{row.planName}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
            {row.productName} · {row.productSlug}
          </div>
        </div>
      ),
    },
    {
      title: '价格',
      key: 'price',
      width: 130,
      render: (_: unknown, row: AdminSubscriptionRow) => (
        <span>{formatMoney(row.monthlyPrice)} / 月</span>
      ),
    },
    {
      title: '月度积分',
      dataIndex: 'monthlyCredits',
      key: 'monthlyCredits',
      width: 110,
      align: 'right' as const,
      render: (value: number) => value.toLocaleString(),
    },
    {
      title: '开始时间',
      dataIndex: 'startedAt',
      key: 'startedAt',
      width: 160,
      render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '到期时间',
      dataIndex: 'expiresAt',
      key: 'expiresAt',
      width: 160,
      render: (value: string | null) => value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (value: AdminSubscriptionRow['status']) => {
        const info = STATUS_LABEL[value];
        return <Tag variant={info.variant}>{info.label}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 170,
      align: 'right' as const,
      render: (_: unknown, row: AdminSubscriptionRow) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => navigate(`/users/${row.userId}`)}>
            查看身份
          </Button>
          <Button
            type="link"
            size="small"
            disabled={!canManage || row.status !== 'ACTIVE'}
            onClick={() => openGrantModal(row)}
          >
            赠送积分
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="订阅账号管理"
        subtitle="按账号和产品跟踪订阅、到期和取消情况"
        actions={[
          <Button key="refresh" onClick={subscriptions.reload}>
            刷新
          </Button>,
        ]}
      />

      <StatCardGroup columns={4}>
        <StatCard label="活跃订阅账号" value={stats.active} variant="success" />
        <StatCard label="7 天内到期" value={stats.expiringSoon} variant="warning" />
        <StatCard label="已取消" value={stats.cancelled} />
        <StatCard label="已过期" value={stats.expired} />
      </StatCardGroup>

      <FilterBar
        filters={[
          <Select
            key="product"
            value={productFilter}
            style={{ width: 180 }}
            onChange={(value) => {
              setProductFilter(value);
            }}
            options={[
              { value: 'all', label: '全部产品' },
              ...products.map((product) => ({
                value: product.id,
                label: product.slug ? `${product.name} (${product.slug})` : product.name,
              })),
            ]}
          />,
          <Input
            key="userId"
            allowClear
            placeholder="用户 ID"
            style={{ width: 260 }}
            value={userIdFilter}
            onChange={(event) => {
              setUserIdFilter(event.target.value);
            }}
          />,
        ]}
      />

      <Tabs
        activeKey={activeTab}
        onChange={(key) => {
          setActiveTab(key as TabKey);
        }}
        items={[
          { key: 'active', label: '生效中' },
          { key: 'expiring', label: '7 天内到期' },
          { key: 'cancelled', label: '已取消' },
          { key: 'expired', label: '已过期' },
        ]}
      />

      {subscriptions.items.length === 0 && !subscriptions.loading ? (
        <EmptyPlaceholder
          title="暂无订阅账号"
          description="当前状态下没有订阅型产品账号。"
        />
      ) : (
        <DataTable<AdminSubscriptionRow>
          rowKey="id"
          columns={columns}
          dataSource={subscriptions.items}
          loading={subscriptions.loading}
          listPagination={subscriptions.tablePagination}
          scroll={{ x: 1100 }}
        />
      )}

      <Modal
        title="赠送订阅积分"
        open={!!grantRow}
        onOk={handleGrantCredits}
        onCancel={closeGrantModal}
        confirmLoading={granting}
        okText="确认赠送"
        cancelText="取消"
        destroyOnHidden
      >
        {grantRow && (
          <div style={{ display: 'grid', gap: 16, marginTop: 12 }}>
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 4 }}>目标订阅账号</div>
              <div style={{ fontWeight: 500 }}>{grantRow.accountName || grantRow.tenantName || grantRow.userEmail}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                {grantRow.productName} / {grantRow.planName} · {grantRow.userEmail}
              </div>
            </div>
            <Form
              form={grantForm}
              layout="vertical"
              requiredMark={false}
              onValuesChange={() => setGrantValidationMessage('')}
            >
              <Form.Item
                label="积分数量"
                name="amount"
                rules={[
                  { required: true, message: '请输入积分数量' },
                  {
                    validator: (_, value: number | null | undefined) => {
                      if (value === undefined || value === null) return Promise.resolve();
                      return Number.isInteger(value) && value > 0
                        ? Promise.resolve()
                        : Promise.reject(new Error('请输入正整数积分数量'));
                    },
                  },
                ]}
              >
                <StableNumberInput
                  min={1}
                  precision={0}
                  style={{ width: '100%' }}
                  placeholder="输入赠送积分数量"
                />
              </Form.Item>
              <Form.Item
                label="赠送原因"
                name="reason"
                rules={[{ required: true, whitespace: true, message: '请填写赠送原因' }]}
              >
                <Input.TextArea
                  rows={3}
                  placeholder="如：上线前体验额度补发"
                />
              </Form.Item>
            </Form>
            {grantValidationMessage ? (
              <Alert type="error" showIcon message={grantValidationMessage} />
            ) : null}
          </div>
        )}
      </Modal>
    </div>
  );
}
