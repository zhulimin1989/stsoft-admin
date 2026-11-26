import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Tabs,
  Spin,
  Button,
  message,
  Input,
  Modal,
  Popconfirm,
} from 'antd';
import {
  BalanceAdjustmentModal,
  DataTable,
  PageHeader,
  StatCard,
  StatCardGroup,
  Tag,
  type BalanceAdjustmentFormValues,
} from '../../components/common';
import { userApi, userManageApi } from '../../api/admin';
import { ProductAccountCard } from './ProductAccountCard';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { usePermission } from '../../hooks/usePermission';
import { formatCurrencyCents } from '../../utils/price';

interface SubscriptionItem {
  id: string;
  subscriptionId?: string;
  status: string;
  startedAt: string | null;
  expiresAt: string | null;
  plan: { id: string; name: string; monthlyPrice?: number; monthlyCredits: number } | null;
  product: {
    id: string;
    name: string;
    slug: string;
    billingMode?: 'SUBSCRIPTION' | 'CODING_PLAN' | 'PAY_AS_YOU_GO';
  } | null;
  quotaCredits?: number;
  bonusCredits?: number;
  productCredits?: number;
  usedThisMonth?: number;
  planCredits?: { remaining: number; total: number; used: number };
}

interface ApiKeyItem {
  id: string;
  name: string;
  prefix: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

interface AuditLogItem {
  id: string;
  userId: string;
  action: string;
  resource: string;
  detail: string | null;
  createdAt: string;
}

interface UserIdentity {
  id?: string;
  provider: string;
  subject?: string;
  email?: string | null;
  emailVerified?: boolean;
  createdAt?: string;
}

interface AvailableAmountItem {
  billingAccountId: string;
  /** personal / enterprise */
  accountType: string;
  accountName: string;
  currency: string;
  balanceCents: number;
  creditRemainingCents: number;
  /** max(0, 余额) + 剩余信用，与「企业账户详情-账户可用余额」同口径 */
  availableAmountCents: number;
}

interface UserOverview {
  id: string;
  email: string;
  phone: string | null;
  nickname: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  subscriptions: SubscriptionItem[];
  balanceCents: number;
  totalCredits: number;
  productCredits?: number;
  sharedGrantCredits?: number;
  totalSpentCents?: number;
  totalRefundedCents?: number;
  netRevenueCents?: number;
  identities?: UserIdentity[];
  availableAmounts?: AvailableAmountItem[];
}

type CardSubscription = {
  id: string;
  productId: string;
  productName: string;
  billingMode: 'SUBSCRIPTION' | 'CODING_PLAN' | 'PAY_AS_YOU_GO';
  plan: { id: string; name: string; monthlyCredits: number };
  status: string;
  startedAt: string;
  expiresAt: string | null;
  quotaCredits: number;
  bonusCredits: number;
  productCredits: number;
  usedThisMonth: number;
  planCredits: { remaining: number; total: number; used: number };
  walletBalanceCents: number;
};

function toCardSubscription(s: SubscriptionItem, walletBalanceCents: number): CardSubscription {
  const quotaCredits = s.quotaCredits ?? s.planCredits?.remaining ?? 0;
  const bonusCredits = s.bonusCredits ?? 0;
  const plan = s.plan ?? {
    id: s.subscriptionId ?? s.id,
    name: '未绑定套餐',
    monthlyCredits: 0,
  };
  return {
    id: s.id,
    productId: s.product?.id ?? s.subscriptionId ?? s.id,
    productName: s.product?.name ?? '未绑定产品',
    billingMode: s.product?.billingMode ?? 'SUBSCRIPTION',
    plan: { id: plan.id, name: plan.name, monthlyCredits: plan.monthlyCredits ?? 0 },
    status: s.status,
    startedAt: s.startedAt ?? '',
    expiresAt: s.expiresAt,
    quotaCredits,
    bonusCredits,
    productCredits: s.productCredits ?? quotaCredits + bonusCredits,
    usedThisMonth: s.usedThisMonth ?? 0,
    planCredits: s.planCredits ?? {
      remaining: quotaCredits,
      total: Math.max(plan.monthlyCredits ?? 0, quotaCredits),
      used: Math.max(0, (plan.monthlyCredits ?? 0) - quotaCredits),
    },
    walletBalanceCents,
  };
}

function normalizeIdentityProviders(identities?: UserIdentity[]): string[] {
  const providers = (identities ?? [])
    .map((identity) => identity.provider?.trim().toLowerCase())
    .filter(Boolean) as string[];
  if (providers.length > 0) return Array.from(new Set(providers));
  return ['local'];
}

function providerLabel(provider: string): string {
  if (provider === 'auth0') return 'Auth0';
  if (provider === 'authing') return 'Authing';
  if (provider === 'local') return '本地';
  return provider;
}

function providerVariant(provider: string): 'success' | 'proc' | 'muted' {
  if (provider === 'auth0') return 'proc';
  if (provider === 'local') return 'muted';
  return 'success';
}

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { message?: unknown } } }).response;
    if (typeof response?.data?.message === 'string' && response.data.message) {
      return response.data.message;
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function balanceAdjustmentIdempotencyKey(userId: string): string {
  const random = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `user-billing-adjustment:${userId}:${random}`;
}

/** 业务方要求：后台用户详情不展示「调整余额」入口。能力与弹窗保留，仅隐藏按钮。 */
const BALANCE_ADJUSTMENT_ENTRY_VISIBLE = false;

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const platformCurrency = usePlatformCurrency();
  const canManage = usePermission('admin.page.users.manage');
  const [overview, setOverview] = useState<UserOverview | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<{ items: AuditLogItem[]; total: number }>({
    items: [],
    total: 0,
  });
  const [auditPage, setAuditPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [resetResult, setResetResult] = useState<{ email: string; tempPassword: string } | null>(
    null,
  );

  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [ov, keys, logs] = await Promise.all([
        userManageApi.overview(id),
        userManageApi.apiKeys(id),
        userManageApi.auditLogs(id, { page: 1, pageSize: 20 }),
      ]);
      setOverview(ov);
      setApiKeys(Array.isArray(keys) ? keys : keys.items || []);
      setAuditLogs(logs);
      setAuditPage(1);
    } catch {
      message.error('加载用户数据失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const handleAuditPageChange = useCallback(async (nextPage: number) => {
    if (!id) return;
    try {
      const logs = await userManageApi.auditLogs(id, { page: nextPage, pageSize: 20 });
      setAuditLogs(logs);
      setAuditPage(nextPage);
    } catch {
      message.error('加载操作记录失败');
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }
  if (!overview) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        用户不存在
      </div>
    );
  }

  const handleResetPassword = async () => {
    if (!overview.id) return;
    try {
      const res = await userManageApi.resetPassword(overview.id);
      setResetResult({
        email: overview.email,
        tempPassword: res.temporaryPassword ?? res.oneTimePassword ?? res.tempPassword ?? res.password ?? '（请查看后端日志）',
      });
    } catch (err) {
      message.error(errorMessage(err, '重置密码失败'));
    }
  };

  const handleBan = async () => {
    if (!overview.id) return;
    try {
      await userManageApi.ban(overview.id, '管理员封禁');
      message.success('用户身份已封禁');
      fetchData();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleUnban = async () => {
    if (!overview.id) return;
    try {
      await userManageApi.unban(overview.id);
      message.success('用户身份已解封');
      fetchData();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleExportAccount = () => {
    if (!overview) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      overview,
      apiKeys,
      auditLogs: auditLogs.items,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `user-${overview.id}-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleBalanceAdjustment = async (values: BalanceAdjustmentFormValues) => {
    const amountCents = Math.round(values.amount * 100);
    const signedAmountCents = values.direction === 'CREDIT' ? amountCents : -amountCents;
    setAdjusting(true);
    try {
      await userApi.adjustBalance(
        overview.id,
        signedAmountCents,
        values.reasonCode,
        values.description.trim(),
        balanceAdjustmentIdempotencyKey(overview.id),
      );
      message.success('余额调整成功');
      setAdjustmentOpen(false);
      await fetchData();
    } catch (err) {
      message.error(errorMessage(err, '余额调整失败'));
    } finally {
      setAdjusting(false);
    }
  };

  const subtitle = `注册 ${new Date(overview.createdAt).toLocaleDateString('zh-CN')}${
    overview.lastLoginAt
      ? ` · 最近登录 ${new Date(overview.lastLoginAt).toLocaleString('zh-CN')}`
      : ' · 从未登录'
  }`;
  const identityProviders = normalizeIdentityProviders(overview.identities);
  const canResetLocalPassword = identityProviders.includes('local');

  const banAction = overview.isActive ? (
    <Popconfirm key="ban" title="确认封禁该用户身份？" onConfirm={handleBan}>
      <Button danger>封禁身份</Button>
    </Popconfirm>
  ) : (
    <Button key="unban" type="primary" onClick={handleUnban}>
      解封身份
    </Button>
  );

  return (
    <div>
      <PageHeader
        title={overview.email || overview.nickname || overview.id}
        subtitle={subtitle}
        breadcrumb={[{ label: '用户列表', to: '/users' }, '用户详情']}
        actions={[
          ...(canManage && BALANCE_ADJUSTMENT_ENTRY_VISIBLE
            ? [
                <Button key="adjust-balance" onClick={() => setAdjustmentOpen(true)}>
                  调整余额
                </Button>,
              ]
            : []),
          ...(canManage && canResetLocalPassword
            ? [
                <Popconfirm key="reset" title="确认重置本地登录密码？" onConfirm={handleResetPassword}>
                  <Button>重置密码</Button>
                </Popconfirm>,
              ]
            : []),
          ...(canManage && !canResetLocalPassword
            ? [
                <Button
                  key="reset-disabled"
                  disabled
                  title="该身份使用 Auth0 或外部提供方登录，请走用户端忘记密码或身份提供方重置"
                >
                  重置密码
                </Button>,
              ]
            : []),
          <Button key="exp" onClick={handleExportAccount}>
            导出账户
          </Button>,
          ...(canManage ? [banAction] : []),
        ]}
      />

      <BalanceAdjustmentModal
        open={adjustmentOpen}
        loading={adjusting}
        entityLabel={overview.email || overview.nickname || overview.id}
        currencyCode={platformCurrency.toUpperCase()}
        currentBalanceCents={overview.balanceCents}
        onSubmit={handleBalanceAdjustment}
        onCancel={() => setAdjustmentOpen(false)}
      />

      <div className="rt-uid-card">
        <div className="rt-uid-avatar">
          {(overview.nickname || overview.email || '?').slice(0, 1).toUpperCase()}
        </div>
        <div className="rt-uid-meta">
          <div className="rt-uid-name">{overview.nickname || '—'}</div>
          <div className="rt-uid-id">
            {overview.phone ? `${overview.phone} · ` : ''}ID {overview.id.slice(0, 8)}...
          </div>
        </div>
        <div className="rt-uid-badges">
          {overview.role === 'ADMIN' && <Tag variant="warn">管理员</Tag>}
          {overview.isActive ? (
            <Tag variant="success">启用</Tag>
          ) : (
            <Tag variant="error">已封禁</Tag>
          )}
          {identityProviders.map((provider) => (
            <Tag key={provider} variant={providerVariant(provider)}>
              {providerLabel(provider)}
            </Tag>
          ))}
        </div>
      </div>

      <StatCardGroup columns={3}>
        <StatCard label="关联产品账号" value={(overview.availableAmounts ?? []).length} />
        <StatCard label="API Key" value={apiKeys.length} />
        <StatCard label="操作记录" value={auditLogs.total} />
      </StatCardGroup>

      <Tabs
        defaultActiveKey="account"
        items={[
          {
            key: 'account',
            label: '关联产品账号',
            children: (
              <AccountTab
                subscriptions={overview.subscriptions ?? []}
                availableAmounts={overview.availableAmounts ?? []}
                balanceCents={overview.balanceCents ?? 0}
                onOpenSubscriptions={() => navigate(`/subscriptions?userId=${overview.id}`)}
              />
            ),
          },
          {
            key: 'orders',
            label: '订单',
            children: <LinkedPanel
              title="查看该用户订单"
              description="打开订单管理页并按当前用户过滤。"
              action="打开订单"
              onClick={() => navigate(`/orders?userId=${overview.id}`)}
            />,
          },
          {
            key: 'usage',
            label: '用量与流水',
            children: <LinkedPanel
              title="查看该用户用量与流水"
              description="打开交易流水页并按当前用户过滤。"
              action="打开流水"
              onClick={() => navigate(`/usage?userId=${overview.id}`)}
            />,
          },
          {
            key: 'keys',
            label: 'API Key',
            children: <ApiKeysTab apiKeys={apiKeys} />,
          },
          {
            key: 'audit',
            label: '操作记录',
            children: <AuditTab logs={auditLogs} page={auditPage} onPageChange={handleAuditPageChange} />,
          },
        ]}
      />

      <Modal
        title="密码已重置"
        open={!!resetResult}
        onOk={() => setResetResult(null)}
        onCancel={() => setResetResult(null)}
        okText="确认"
        cancelButtonProps={{ style: { display: 'none' } }}
      >
        {resetResult && (
          <div>
            <p>
              用户 <strong>{resetResult.email}</strong> 的临时密码：
            </p>
            <Input.Password
              value={resetResult.tempPassword}
              readOnly
              style={{ fontFamily: 'monospace', fontSize: 16 }}
            />
            <p style={{ marginTop: 12, color: 'var(--text-muted)', fontSize: 13 }}>
              临时密码只适用于用户端邮箱/手机号 + 密码表单登录；不要使用 Auth0、Google 或 GitHub 入口。
              登录后请到用户端设置页修改密码。
            </p>
          </div>
        )}
      </Modal>

      <style>{`
        .rt-uid-card {
          background: var(--bg-panel);
          border: 1px solid var(--border-soft);
          border-radius: var(--radius-card);
          padding: 14px 16px;
          margin-bottom: 14px;
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 16px;
          align-items: center;
        }
        .rt-uid-avatar {
          width: 48px; height: 48px;
          border-radius: var(--radius-pill);
          background: linear-gradient(135deg, var(--primary), var(--info));
          color: var(--bg-panel);
          display: flex; align-items: center; justify-content: center;
          font-size: var(--fs-lg); font-weight: 500;
        }
        .rt-uid-name { font-size: var(--fs-md); font-weight: 500; color: var(--primary-dark); }
        .rt-uid-id { font-size: var(--fs-sm); color: var(--text-secondary); margin-top: 3px; }
        .rt-uid-badges { display: flex; gap: 6px; }
        .rt-uid-stats {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
          gap: 12px;
          margin-bottom: 14px;
        }
        .rt-uid-stat {
          background: var(--bg-panel);
          border: 1px solid var(--border-soft);
          border-radius: var(--radius-card);
          padding: 14px 16px;
        }
        .rt-uid-stat-label { font-size: var(--fs-sm); color: var(--text-muted); }
        .rt-uid-stat-tag {
          display: inline-block;
          margin-left: 6px;
          padding: 0 6px;
          border-radius: var(--radius-pill, 999px);
          background: var(--bg-sub, #F4F1EA);
          color: var(--text-secondary);
          font-size: var(--fs-xs);
          line-height: 18px;
        }
        .rt-uid-stat-tag-personal {
          background: rgba(0, 47, 167, 0.08);
          color: var(--primary-dark);
        }
        .rt-uid-stat-value { font-size: 22px; font-weight: 600; color: var(--primary-dark); margin-top: 4px; }
        .rt-uid-stat-help { font-size: var(--fs-xs); color: var(--text-muted); margin-top: 4px; }
        @media (max-width: 1100px) {
          .rt-uid-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 640px) {
          .rt-uid-stats { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}

function LinkedPanel({
  title,
  description,
  action,
  onClick,
}: {
  title: string;
  description: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <div style={{ padding: 24, color: 'var(--text-muted)' }}>
      <div style={{ marginBottom: 4, color: 'var(--text-primary)', fontWeight: 500 }}>
        {title}
      </div>
      <div style={{ marginBottom: 12 }}>{description}</div>
      <Button onClick={onClick}>{action}</Button>
    </div>
  );
}

function AccountTab({
  subscriptions,
  availableAmounts,
  balanceCents,
  onOpenSubscriptions,
}: {
  subscriptions: SubscriptionItem[];
  availableAmounts: AvailableAmountItem[];
  balanceCents: number;
  onOpenSubscriptions: () => void;
}) {
  const platformCurrency = usePlatformCurrency();
  return (
    <div>
      <div className="rt-uid-stats">
        {availableAmounts.length === 0 ? (
          <div className="rt-uid-stat">
            <div className="rt-uid-stat-label">可用金额</div>
            <div className="rt-uid-stat-value">
              {formatCurrencyCents(0, platformCurrency)}
            </div>
            <div className="rt-uid-stat-help">暂无账务账户</div>
          </div>
        ) : (
          availableAmounts.map((account) => {
            const isEnterprise = account.accountType === 'enterprise';
            return (
              <div className="rt-uid-stat" key={account.billingAccountId}>
                <div className="rt-uid-stat-label">
                  可用金额
                  {isEnterprise ? (
                    <span className="rt-uid-stat-tag">企业账户</span>
                  ) : (
                    <span className="rt-uid-stat-tag rt-uid-stat-tag-personal">个人账户</span>
                  )}
                </div>
                <div className="rt-uid-stat-value">
                  {formatCurrencyCents(
                    account.availableAmountCents,
                    account.currency || platformCurrency,
                  )}
                </div>
                <div className="rt-uid-stat-help">
                  {isEnterprise ? account.accountName : '当前用户'}
                </div>
              </div>
            );
          })
        )}
      </div>

      {subscriptions.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>
          <p>该身份尚未关联任何产品账号</p>
          <Button onClick={onOpenSubscriptions}>打开订阅账号管理</Button>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
            gap: 12,
          }}
        >
          {subscriptions.map((s) => (
            <ProductAccountCard
              key={s.id}
              subscription={toCardSubscription(s, balanceCents)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ApiKeysTab({ apiKeys }: { apiKeys: ApiKeyItem[] }) {
  return (
    <DataTable<ApiKeyItem>
      dataSource={apiKeys}
      rowKey="id"
      searchable
      searchPlaceholder="搜索 Key 名称 / 前缀"
      pagination={false}
      size="small"
      locale={{ emptyText: '暂无 API Key' }}
      columns={[
        { title: '名称', dataIndex: 'name', key: 'name' },
        {
          title: '前缀',
          dataIndex: 'prefix',
          key: 'prefix',
          render: (v: string) => <code>{v}...</code>,
        },
        {
          title: '状态',
          dataIndex: 'isActive',
          key: 'isActive',
          render: (v: boolean) =>
            v ? <Tag variant="success">启用</Tag> : <Tag variant="muted">停用</Tag>,
        },
        {
          title: '创建时间',
          dataIndex: 'createdAt',
          key: 'createdAt',
          render: (v: string) => new Date(v).toLocaleDateString('zh-CN'),
        },
      ]}
    />
  );
}

function AuditTab({
  logs,
  page,
  onPageChange,
}: {
  logs: { items: AuditLogItem[]; total: number };
  page: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <DataTable<AuditLogItem>
      dataSource={logs.items}
      rowKey="id"
      listPagination={{
        current: page,
        total: logs.total,
        pageSize: 20,
        size: 'small',
        onChange: onPageChange,
      }}
      size="small"
      locale={{ emptyText: '暂无操作记录' }}
      columns={[
        {
          title: '时间',
          dataIndex: 'createdAt',
          key: 'createdAt',
          width: 170,
          render: (v: string) => new Date(v).toLocaleString('zh-CN'),
        },
        { title: '操作', dataIndex: 'action', key: 'action', width: 200 },
        { title: '资源', dataIndex: 'resource', key: 'resource', width: 100 },
        {
          title: '详情',
          dataIndex: 'detail',
          key: 'detail',
          render: (v: string | null) => {
            if (!v) return '—';
            try {
              const obj = JSON.parse(v);
              return (
                <span style={{ display: 'inline-block', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {JSON.stringify(obj)}
                </span>
              );
            } catch {
              return (
                <span style={{ display: 'inline-block', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {v}
                </span>
              );
            }
          },
        },
      ]}
    />
  );
}
