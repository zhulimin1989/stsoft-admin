import { useState, useCallback, useMemo } from 'react';
import {
  Button,
  Alert,
  Modal,
  Form,
  Input,
  Select,
  message,
  Typography,
  Popconfirm,
  Descriptions,
  Space,
} from 'antd';
import {
  UndoOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  EyeOutlined,
  ExportOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { orderAdminApi } from '../../api/admin';
import {
  PageHeader,
  StatCard,
  StatCardGroup,
  FilterBar,
  DataTable,
  DetailDrawer,
  Tag,
} from '../../components/common';
import type { TagVariant } from '../../components/common';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { usePermission } from '../../hooks/usePermission';
import { formatCurrencyCents, normalizeCurrency } from '../../utils/price';
import './Orders.css';

const { Option } = Select;

interface AuditLogItem {
  id: string;
  fromStatus: string;
  toStatus: string;
  operator: string;
  detail: string | null;
  createdAt: string;
}

interface Order {
  id: string;
  userId?: string;
  user?: { id?: string; email?: string | null; nickname?: string | null };
  userEmail?: string;
  orderType: string;
  productId?: string | null;
  codingPlanFulfillmentMode?: string | null;
  product?: {
    id: string;
    name: string;
    slug?: string;
    billingMode?: string;
    codingPlanFulfillmentMode?: string | null;
  };
  planName?: string;
  plan?: { id: string; name: string };
  boosterPackName?: string;
  boosterPack?: { id: string; name: string };
  amountCents: number;
  currency?: string | null;
  status: string;
  channel: string;
  tradeNo?: string;
  clientIp?: string;
  paidAt: string | null;
  completedAt?: string | null;
  expiredAt?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string;
  refundedAt?: string | null;
  refundReason?: string;
  refundAmountCents?: number;
  createdAt: string;
  auditLogs?: AuditLogItem[];
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  PENDING: { label: '待支付', color: 'default' },
  PAID: { label: '已支付', color: 'processing' },
  FULFILLING: { label: '充值中', color: 'processing' },
  COMPLETED: { label: '已完成', color: 'success' },
  EXPIRED: { label: '已过期', color: 'default' },
  CANCELLED: { label: '已取消', color: 'default' },
  FAILED: { label: '充值失败', color: 'error' },
  REFUNDING: { label: '退款中', color: 'warning' },
  REFUNDED: { label: '已退款', color: 'purple' },
  REFUND_FAILED: { label: '退款失败', color: 'error' },
};

const ORDER_TYPE_MAP: Record<string, { label: string; color: string }> = {
  SUBSCRIPTION: { label: '订阅', color: 'blue' },
  BOOSTER_PACK: { label: '加油包', color: 'orange' },
  RECHARGE: { label: '充值', color: 'green' },
};

const ABNORMAL_STATUSES = new Set(['FAILED', 'REFUND_FAILED']);
const REFUND_PENDING_STATUSES = new Set(['REFUNDING']);
const SUCCESS_STATUSES = new Set(['PAID', 'COMPLETED', 'REFUNDED']);
const PROVIDER_RESALE_FULFILLMENT_MODE = 'provider_resale';
const PROVIDER_RESALE_REFUND_BLOCK_MESSAGE =
  '供应商转售套餐需人工核对并撤销上游权益，当前不能自动退款。';

function isFormValidationError(error: unknown): boolean {
  return Boolean(
    error
      && typeof error === 'object'
      && Array.isArray((error as { errorFields?: unknown }).errorFields),
  );
}

function getApiErrorMessage(error: unknown, fallback: string): string {
  const responseMessage = (
    error as { response?: { data?: { message?: unknown } } }
  )?.response?.data?.message;
  if (typeof responseMessage === 'string' && responseMessage.trim()) {
    return responseMessage;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function isProviderResaleCodingPlanOrder(order: Order | null): boolean {
  return order?.codingPlanFulfillmentMode
    === PROVIDER_RESALE_FULFILLMENT_MODE;
}

function statusVariant(status: string): TagVariant {
  if (status === 'PAID' || status === 'COMPLETED') return 'success';
  if (status === 'REFUNDING' || status === 'FULFILLING') return 'proc';
  if (status === 'FAILED' || status === 'REFUND_FAILED') return 'error';
  if (status === 'REFUNDED') return 'muted';
  if (status === 'PENDING') return 'warn';
  return 'muted';
}

function orderTypeVariant(type: string): TagVariant {
  if (type === 'SUBSCRIPTION') return 'proc';
  if (type === 'BOOSTER_PACK') return 'warn';
  if (type === 'RECHARGE') return 'success';
  return 'muted';
}

const formatOrderAmount = (
  order: Pick<Order, 'amountCents' | 'currency'>,
  fallbackCurrency: string,
  cents = order.amountCents,
) => formatCurrencyCents(cents, order.currency ?? fallbackCurrency);

const formatCurrencyTotals = (totals: Record<string, number>, fallbackCurrency: string) => {
  const entries = Object.entries(totals).filter(([, cents]) => cents !== 0);
  if (!entries.length) return formatCurrencyCents(0, fallbackCurrency);
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, cents]) => formatCurrencyCents(cents, currency))
    .join(' / ');
};

const getOrderUserId = (order: Pick<Order, 'userId' | 'user'>) => order.user?.id || order.userId || '-';

function OrderTimeline({ logs }: { logs: AuditLogItem[] }) {
  const dotColor = (toStatus: string): string => {
    if (toStatus === 'PAID' || toStatus === 'COMPLETED') return 'var(--success)';
    if (toStatus === 'FAILED' || toStatus === 'REFUND_FAILED') return 'var(--error)';
    if (toStatus === 'REFUNDING' || toStatus === 'FULFILLING') return 'var(--warning)';
    return 'var(--primary)';
  };
  if (!logs.length) {
    return <div className="rt-timeline-meta">暂无状态变更记录</div>;
  }
  return (
    <div className="rt-timeline">
      {logs.map((l) => {
        const fromLabel = STATUS_MAP[l.fromStatus]?.label ?? l.fromStatus;
        const toLabel = STATUS_MAP[l.toStatus]?.label ?? l.toStatus;
        return (
          <div className="rt-timeline-item" key={l.id}>
            <span className="rt-timeline-dot" style={{ background: dotColor(l.toStatus) }} />
            <div>
              <div className="rt-timeline-action">{fromLabel} → {toLabel}</div>
              <div className="rt-timeline-meta">
                {new Date(l.createdAt).toLocaleString('zh-CN')} · {l.operator}
              </div>
              {l.detail && <div className="rt-timeline-detail">{l.detail}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function OrdersPage() {
  const platformCurrency = usePlatformCurrency();
  const canManage = usePermission('admin.page.orders.manage');
  const [searchParams] = useSearchParams();
  const userIdFilter = searchParams.get('userId') ?? '';
  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [channelFilter, setChannelFilter] = useState('');

  // Detail drawer
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Refund modal (preserve existing flow)
  const [refundModalOpen, setRefundModalOpen] = useState(false);
  const [refundingOrder, setRefundingOrder] = useState<Order | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [refundError, setRefundError] = useState('');
  const [refundForm] = Form.useForm();

  const orders = usePaginatedList<Order>({
    pageSize: 20,
    deps: [statusFilter, typeFilter, channelFilter, search, userIdFilter],
    onError: () => message.error('加载订单列表失败'),
    fetcher: useCallback(async ({ page, pageSize }) => {
      const params: Record<string, unknown> = { page, pageSize };
      if (statusFilter) params.status = statusFilter;
      if (typeFilter) params.orderType = typeFilter;
      if (channelFilter) params.channel = channelFilter;
      if (search) params.search = search;
      if (userIdFilter) params.userId = userIdFilter;
      const res = await orderAdminApi.list(params as { page?: number; pageSize?: number });
      const items = Array.isArray(res) ? res : res.items || [];
      return {
        items,
        total: Array.isArray(res) ? items.length : res.total || 0,
        page,
        pageSize,
      };
    }, [channelFilter, search, statusFilter, typeFilter, userIdFilter]),
  });

  const openDetail = useCallback(async (orderId: string) => {
    setDetailLoading(true);
    try {
      const detail = await orderAdminApi.getDetail(orderId);
      setDetailOrder(detail);
    } catch {
      message.error('加载订单详情失败');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleCancel = async (orderId: string) => {
    try {
      await orderAdminApi.cancel(orderId, '管理员取消');
      message.success('订单已取消');
      orders.reload();
      if (detailOrder?.id === orderId) setDetailOrder(null);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '取消失败');
    }
  };

  const handleRetry = async (orderId: string) => {
    try {
      await orderAdminApi.retry(orderId);
      message.success('重试已触发');
      orders.reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '重试失败');
    }
  };

  const handleRefundClick = (record: Order) => {
    setRefundingOrder(record);
    setRefundError('');
    setRefundModalOpen(true);
  };

  const handleRefund = async () => {
    if (!refundingOrder || isProviderResaleCodingPlanOrder(refundingOrder)) return;
    setRefundError('');
    try {
      const values = await refundForm.validateFields();
      setRefunding(true);
      await orderAdminApi.refund(refundingOrder.id, values.reason);
      message.success('退款成功');
      setRefundModalOpen(false);
      setRefundingOrder(null);
      // close drawer if currently viewing same order
      if (detailOrder?.id === refundingOrder.id) setDetailOrder(null);
      orders.reload();
    } catch (error) {
      if (isFormValidationError(error)) return;
      const errorMessage = getApiErrorMessage(error, '退款失败');
      setRefundError(errorMessage);
      message.error(errorMessage);
    } finally {
      setRefunding(false);
    }
  };

  const closeRefundModal = () => {
    setRefundModalOpen(false);
    setRefundingOrder(null);
    setRefundError('');
  };

  const providerResaleRefundBlocked =
    isProviderResaleCodingPlanOrder(refundingOrder);

  // Stats derived from current page (TODO: server-side aggregates)
  const stats = useMemo(() => {
    const today = dayjs().format('YYYY-MM-DD');
    const todayItems = orders.items.filter((o) => dayjs(o.createdAt).format('YYYY-MM-DD') === today);
    const todayCount = todayItems.length;
    const todayGmvByCurrency = todayItems
      .filter((o) => SUCCESS_STATUSES.has(o.status))
      .reduce<Record<string, number>>((acc, o) => {
        const currency = normalizeCurrency(o.currency, platformCurrency);
        acc[currency] = (acc[currency] ?? 0) + o.amountCents;
        return acc;
      }, {});
    const totalSettled = orders.items.filter((o) => o.status !== 'PENDING' && o.status !== 'CANCELLED').length;
    const paidOrCompleted = orders.items.filter((o) => o.status === 'PAID' || o.status === 'COMPLETED').length;
    const successRate = totalSettled > 0 ? Math.round((paidOrCompleted / totalSettled) * 100) : 0;
    const refundPending = orders.items.filter((o) => REFUND_PENDING_STATUSES.has(o.status)).length;
    const abnormal = orders.items.filter((o) => ABNORMAL_STATUSES.has(o.status)).length;
    return { todayCount, todayGmvText: formatCurrencyTotals(todayGmvByCurrency, platformCurrency), successRate, refundPending, abnormal };
  }, [orders.items, platformCurrency]);

  const columns = [
    {
      title: '订单号',
      dataIndex: 'id',
      key: 'id',
      width: 180,
      render: (id: string) => (
        <Typography.Text style={{ fontFamily: 'monospace', fontSize: 12 }} ellipsis={{ tooltip: id }}>
          {id.slice(0, 12)}…
        </Typography.Text>
      ),
    },
    {
      title: '用户',
      key: 'user',
      width: 180,
      render: (_: unknown, record: Order) => {
        const userId = getOrderUserId(record);
        return (
          <Typography.Text style={{ fontFamily: 'monospace', fontSize: 12 }} ellipsis={{ tooltip: userId }}>
            {userId}
          </Typography.Text>
        );
      },
    },
    {
      title: '类型',
      dataIndex: 'orderType',
      key: 'orderType',
      width: 90,
      render: (type: string) => (
        <Tag variant={orderTypeVariant(type)}>{ORDER_TYPE_MAP[type]?.label || type}</Tag>
      ),
    },
    {
      title: '产品',
      key: 'product',
      width: 160,
      render: (_: unknown, r: Order) => r.product?.name || r.plan?.name || r.boosterPack?.name || r.planName || r.boosterPackName || '-',
    },
    {
      title: '金额',
      dataIndex: 'amountCents',
      key: 'amountCents',
      width: 100,
      render: (v: number, record: Order) => <span style={{ fontWeight: 500 }}>{formatOrderAmount(record, platformCurrency, v)}</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => (
        <Tag variant={statusVariant(status)}>{STATUS_MAP[status]?.label || status}</Tag>
      ),
    },
    {
      title: '渠道',
      dataIndex: 'channel',
      key: 'channel',
      width: 90,
      render: (ch: string) => ch || '-',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (t: string) => dayjs(t).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      render: (_: unknown, record: Order) => (
        <Space size={4} onClick={(e) => e.stopPropagation()}>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openDetail(record.id)}>
            详情
          </Button>
          {canManage && record.status === 'PENDING' && (
            <Popconfirm title="确认取消此订单？" onConfirm={() => handleCancel(record.id)}>
              <Button type="link" size="small" icon={<CloseCircleOutlined />}>取消</Button>
            </Popconfirm>
          )}
          {canManage && record.status === 'FAILED' && (
            <Popconfirm title="确认重试充值？" onConfirm={() => handleRetry(record.id)}>
              <Button type="link" size="small" icon={<ReloadOutlined />}>重试</Button>
            </Popconfirm>
          )}
          {canManage && (record.status === 'PAID' || record.status === 'COMPLETED') && (
            <Button type="link" size="small" danger icon={<UndoOutlined />} onClick={() => handleRefundClick(record)}>
              退款
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="订单管理"
        subtitle={
          userIdFilter
            ? `订阅 / 加油包 / 充值订单 · 当前用户 ${userIdFilter}`
            : '订阅 / 加油包 / 充值订单 · 含审计时间线'
        }
        actions={[
          <Button key="export" icon={<ExportOutlined />}>
            导出
          </Button>,
          <Button
            key="abnormal"
            icon={<WarningOutlined />}
            onClick={() => {
              setStatusFilter('FAILED');
            }}
          >
            异常订单
          </Button>,
        ]}
      />

      {/* TODO: replace with server-side aggregates (今日订单 / 今日 GMV / 支付成功率 / 待处理退款 / 异常订单) */}
      <StatCardGroup columns={5}>
        <StatCard label="今日订单" value={stats.todayCount} />
        <StatCard label="今日 GMV" value={stats.todayGmvText} />
        <StatCard
          label="支付成功率"
          value={`${stats.successRate}%`}
          variant={stats.successRate >= 90 ? 'success' : stats.successRate >= 70 ? 'default' : 'warning'}
        />
        <StatCard
          label="待处理退款"
          value={stats.refundPending}
          variant={stats.refundPending > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="异常订单"
          value={stats.abnormal}
          variant={stats.abnormal > 0 ? 'error' : 'default'}
        />
      </StatCardGroup>

      <FilterBar
        search={{
          placeholder: '搜索订单号 / 交易号',
          onSearch: (v) => {
            setSearch(v);
          },
        }}
        filters={[
          <Select
            key="status"
            value={statusFilter || 'all'}
            style={{ width: 130 }}
            onChange={(v) => {
              setStatusFilter(v === 'all' ? '' : v);
            }}
          >
            <Option value="all">全部状态</Option>
            <Option value="PENDING">待支付</Option>
            <Option value="PAID">已支付</Option>
            <Option value="FULFILLING">充值中</Option>
            <Option value="COMPLETED">已完成</Option>
            <Option value="EXPIRED">已过期</Option>
            <Option value="CANCELLED">已取消</Option>
            <Option value="FAILED">充值失败</Option>
            <Option value="REFUNDING">退款中</Option>
            <Option value="REFUNDED">已退款</Option>
            <Option value="REFUND_FAILED">退款失败</Option>
          </Select>,
          <Select
            key="type"
            value={typeFilter || 'all'}
            style={{ width: 130 }}
            onChange={(v) => {
              setTypeFilter(v === 'all' ? '' : v);
            }}
          >
            <Option value="all">全部类型</Option>
            <Option value="SUBSCRIPTION">订阅</Option>
            <Option value="BOOSTER_PACK">加油包</Option>
            <Option value="RECHARGE">充值</Option>
          </Select>,
          <Select
            key="channel"
            value={channelFilter || 'all'}
            style={{ width: 130 }}
            onChange={(v) => {
              setChannelFilter(v === 'all' ? '' : v);
            }}
          >
            <Option value="all">全部渠道</Option>
            <Option value="ALIPAY">支付宝</Option>
            <Option value="WECHAT">微信</Option>
            <Option value="STRIPE">Stripe</Option>
            <Option value="MANUAL">手动</Option>
          </Select>,
        ]}
        rightActions={
          <Button icon={<ReloadOutlined />} onClick={orders.reload}>
            刷新
          </Button>
        }
      />

      <DataTable<Order>
        columns={columns}
        dataSource={orders.items}
        rowKey="id"
        loading={orders.loading}
        scroll={{ x: 1200 }}
        size="middle"
        onRowClick={(record) => openDetail(record.id)}
        selectedRowKey={detailOrder?.id}
        listPagination={orders.tablePagination}
      />

      {/* 订单详情 Drawer */}
      <DetailDrawer
        open={!!detailOrder || detailLoading}
        onClose={() => setDetailOrder(null)}
        title={detailOrder?.id ?? '加载中…'}
        subtitle={
          detailOrder
            ? `${getOrderUserId(detailOrder)} · ${
                detailOrder.product?.name ?? detailOrder.plan?.name ?? detailOrder.boosterPack?.name ?? detailOrder.planName ?? detailOrder.boosterPackName ?? '-'
              } · ${formatOrderAmount(detailOrder, platformCurrency)}`
            : ''
        }
        status={
          detailOrder ? (
            <Tag variant={statusVariant(detailOrder.status)}>
              {STATUS_MAP[detailOrder.status]?.label || detailOrder.status}
            </Tag>
          ) : undefined
        }
        tabs={[
          {
            key: 'basic',
            label: '基本信息',
            content: detailOrder ? (
              <div>
                <Descriptions column={1} size="small" bordered={false} labelStyle={{ color: 'var(--text-muted)', width: 100 }}>
                  <Descriptions.Item label="订单 ID">
                    <Typography.Text copyable style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {detailOrder.id}
                    </Typography.Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="订单类型">
                    {ORDER_TYPE_MAP[detailOrder.orderType]?.label || detailOrder.orderType}
                  </Descriptions.Item>
                  <Descriptions.Item label="产品">
                    {detailOrder.product?.name || '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="支付渠道">{detailOrder.channel || '—'}</Descriptions.Item>
                  <Descriptions.Item label="支付时间">
                    {detailOrder.paidAt ? dayjs(detailOrder.paidAt).format('YYYY-MM-DD HH:mm:ss') : '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="完成时间">
                    {detailOrder.completedAt ? dayjs(detailOrder.completedAt).format('YYYY-MM-DD HH:mm:ss') : '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="创建时间">
                    {dayjs(detailOrder.createdAt).format('YYYY-MM-DD HH:mm:ss')}
                  </Descriptions.Item>
                  <Descriptions.Item label="交易号">{detailOrder.tradeNo || '—'}</Descriptions.Item>
                  <Descriptions.Item label="客户端 IP">{detailOrder.clientIp || '—'}</Descriptions.Item>
                  {detailOrder.cancelReason && (
                    <Descriptions.Item label="取消原因">{detailOrder.cancelReason}</Descriptions.Item>
                  )}
                  {detailOrder.refundReason && (
                    <Descriptions.Item label="退款原因">{detailOrder.refundReason}</Descriptions.Item>
                  )}
                  {detailOrder.refundAmountCents != null && (
                    <Descriptions.Item label="退款金额">
                      {formatOrderAmount(detailOrder, platformCurrency, detailOrder.refundAmountCents)}
                    </Descriptions.Item>
                  )}
                </Descriptions>
                <div className="rt-timeline-section-title">时间线</div>
                <OrderTimeline logs={detailOrder.auditLogs ?? []} />
              </div>
            ) : (
              <div className="rt-timeline-meta">加载中…</div>
            ),
          },
        ]}
        actions={
          detailOrder ? (
            <Space>
              {canManage && detailOrder.status === 'PENDING' && (
                <Popconfirm title="确认取消此订单？" onConfirm={() => handleCancel(detailOrder.id)}>
                  <Button icon={<CloseCircleOutlined />}>取消订单</Button>
                </Popconfirm>
              )}
              {canManage && detailOrder.status === 'FAILED' && (
                <Popconfirm title="确认重试充值？" onConfirm={() => handleRetry(detailOrder.id)}>
                  <Button icon={<ReloadOutlined />}>重试</Button>
                </Popconfirm>
              )}
              {canManage && (detailOrder.status === 'PAID' || detailOrder.status === 'COMPLETED') && (
                <Button danger icon={<UndoOutlined />} onClick={() => handleRefundClick(detailOrder)}>
                  退款
                </Button>
              )}
              <Button onClick={() => setDetailOrder(null)}>关闭</Button>
            </Space>
          ) : undefined
        }
      />

      {/* 退款弹窗 (preserved) */}
      <Modal
        title={providerResaleRefundBlocked ? '供应商转售套餐退款处理' : '确认退款'}
        open={refundModalOpen}
        onOk={handleRefund}
        onCancel={closeRefundModal}
        okText={providerResaleRefundBlocked ? '需人工处理' : '确认退款'}
        okButtonProps={{ danger: true, disabled: providerResaleRefundBlocked }}
        cancelText={providerResaleRefundBlocked ? '关闭' : '取消'}
        confirmLoading={refunding}
        width={480}
        destroyOnHidden
      >
        {providerResaleRefundBlocked && (
          <Alert
            type="warning"
            showIcon
            message="供应商转售套餐需人工处理"
            description={PROVIDER_RESALE_REFUND_BLOCK_MESSAGE}
            style={{ marginBottom: 16 }}
          />
        )}
        {refundError && (
          <Alert
            type="error"
            showIcon
            message="退款未提交成功"
            description={refundError}
            style={{ marginBottom: 16 }}
          />
        )}
        {refundingOrder && (
          <div style={{ marginBottom: 16 }}>
            <Typography.Text type="secondary">
              订单金额：{formatOrderAmount(refundingOrder, platformCurrency)}
              {' | '}
              用户：{getOrderUserId(refundingOrder)}
            </Typography.Text>
          </div>
        )}
        {!providerResaleRefundBlocked && (
          <Form form={refundForm} layout="vertical" clearOnDestroy>
            <Form.Item name="reason" label="退款原因" rules={[{ required: true, message: '请输入退款原因' }]}>
              <Input.TextArea rows={3} placeholder="请输入退款原因" />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  );
}
