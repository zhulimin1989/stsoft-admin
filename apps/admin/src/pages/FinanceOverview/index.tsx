import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, DatePicker, Spin, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { financeReportsApi } from '../../api/admin';
import { DataTable, PageHeader, StatCard, StatCardGroup } from '../../components/common';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { formatCurrencyCents } from '../../utils/price';
import './FinanceOverview.css';

interface FinanceDashboardRow {
  productId: string | null;
  productName: string;
  productSlug: string | null;
  billingMode: string;
  productCount?: number;
  orderRevenueCents: number;
  refundCents: number;
  netRevenueCents: number;
  apiChargeCents: number;
  usageCount: number;
  totalTokens: number;
  rechargeCents: number;
  balanceConsumeCents: number;
  creditGranted: number;
  creditConsumed: number;
}

interface FinanceDashboardData {
  period: {
    month: string;
    startDate: string;
    endDate: string;
    timezone: string;
  };
  totals: {
    orderCount: number;
    refundedOrderCount: number;
    tokenUsageCount: number;
    orderRevenueCents: number;
    rechargeCents: number;
    balanceConsumeCents: number;
    refundCents: number;
    apiChargeCents: number;
    tokenPlanRecognizedRevenueCents?: number;
    tokenPlanClosingDeferredCents?: number;
    totalTokens: number;
  };
  byBillingMode: FinanceDashboardRow[];
  byProduct: FinanceDashboardRow[];
  notes: string[];
}

const MODE_LABELS: Record<string, string> = {
  SUBSCRIPTION: '订阅',
  PAY_AS_YOU_GO: '按量',
  CODING_PLAN: 'CodingPlan',
  UNKNOWN: '未归类',
};

const MODE_COLORS: Record<string, string> = {
  SUBSCRIPTION: '#2563eb',
  PAY_AS_YOU_GO: '#059669',
  CODING_PLAN: '#d97706',
  UNKNOWN: '#6b7280',
};

function money(value: unknown, currency: string) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? formatCurrencyCents(num, currency) : '—';
}

function numberText(value: unknown) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num.toLocaleString('zh-CN') : '—';
}

export default function FinanceOverviewPage() {
  const platformCurrency = usePlatformCurrency();
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'));
  const [data, setData] = useState<FinanceDashboardData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    financeReportsApi
      .dashboard({ month })
      .then(setData)
      .catch(() => {
        message.error('财务总览加载失败');
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  const modeRows = useMemo(() => (data?.byBillingMode ?? []).map((row) => ({
    ...row,
    label: MODE_LABELS[row.billingMode] ?? row.billingMode,
  })), [data]);

  const topProducts = useMemo(() => (data?.byProduct ?? []).slice(0, 10), [data]);

  const productColumns: ColumnsType<FinanceDashboardRow> = [
    {
      title: '产品',
      dataIndex: 'productName',
      key: 'productName',
      width: 180,
      render: (_, row) => (
        <div>
          <div className="finance-overview-product-name">{row.productName}</div>
          <Typography.Text type="secondary">{row.productSlug ?? row.productId ?? '未绑定'}</Typography.Text>
        </div>
      ),
    },
    {
      title: '计费模式',
      dataIndex: 'billingMode',
      key: 'billingMode',
      width: 130,
      render: (value) => MODE_LABELS[String(value)] ?? String(value),
    },
    {
      title: '净收入',
      dataIndex: 'netRevenueCents',
      key: 'netRevenueCents',
      align: 'right',
      render: (value) => money(value, platformCurrency),
    },
    {
      title: '订单收入',
      dataIndex: 'orderRevenueCents',
      key: 'orderRevenueCents',
      align: 'right',
      render: (value) => money(value, platformCurrency),
    },
    {
      title: '退款',
      dataIndex: 'refundCents',
      key: 'refundCents',
      align: 'right',
      render: (value) => money(value, platformCurrency),
    },
    {
      title: 'API 扣费',
      dataIndex: 'apiChargeCents',
      key: 'apiChargeCents',
      align: 'right',
      render: (value) => money(value, platformCurrency),
    },
    {
      title: '请求数',
      dataIndex: 'usageCount',
      key: 'usageCount',
      align: 'right',
      render: numberText,
    },
    {
      title: 'Token',
      dataIndex: 'totalTokens',
      key: 'totalTokens',
      align: 'right',
      render: numberText,
    },
  ];

  return (
    <div className="finance-overview">
      <PageHeader
        title="财务总览"
        subtitle={data ? `${data.period.month} · ${data.period.timezone} 账期` : '按计费模式和产品拆分财务指标'}
        actions={[
          <DatePicker
            key="month"
            picker="month"
            allowClear={false}
            value={dayjs(month)}
            onChange={(value) => setMonth((value ?? dayjs()).format('YYYY-MM'))}
          />,
          <Button key="reload" icon={<ReloadOutlined />} onClick={load} loading={loading}>
            刷新
          </Button>,
        ]}
      />

      {loading && !data ? (
        <Spin size="large" className="finance-overview-spin" />
      ) : (
        <>
          <StatCardGroup columns={5}>
            <StatCard label="订单收入" value={money(data?.totals.orderRevenueCents, platformCurrency)} />
            <StatCard label="退款" value={money(data?.totals.refundCents, platformCurrency)} variant="warning" />
            <StatCard label="API 扣费" value={money(data?.totals.apiChargeCents, platformCurrency)} variant="success" />
            <StatCard label="API 请求" value={numberText(data?.totals.tokenUsageCount)} />
            <StatCard label="总 Token" value={numberText(data?.totals.totalTokens)} />
          </StatCardGroup>

          <div className="finance-overview-grid">
            <section className="finance-overview-panel">
              <div className="finance-overview-panel-head">
                <h2>计费模式收入</h2>
                <Typography.Text type="secondary">净收入 = 订单收入 - 退款</Typography.Text>
              </div>
              <ResponsiveContainer width="100%" height={280} minWidth={0}>
                <BarChart data={modeRows}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" />
                  <YAxis tickFormatter={(value) => money(Number(value), platformCurrency)} />
                  <Tooltip formatter={(value) => money(value, platformCurrency)} />
                  <Bar dataKey="netRevenueCents" name="净收入" radius={[4, 4, 0, 0]}>
                    {modeRows.map((row) => (
                      <Cell key={row.billingMode} fill={MODE_COLORS[row.billingMode] ?? '#64748b'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </section>

            <section className="finance-overview-panel">
              <div className="finance-overview-panel-head">
                <h2>API 扣费拆分</h2>
                <Typography.Text type="secondary">按计费模式汇总实际用户扣费</Typography.Text>
              </div>
              <ResponsiveContainer width="100%" height={280} minWidth={0}>
                <PieChart>
                  <Pie
                    data={modeRows}
                    dataKey="apiChargeCents"
                    nameKey="label"
                    innerRadius={72}
                    outerRadius={108}
                    paddingAngle={2}
                  >
                    {modeRows.map((row) => (
                      <Cell key={row.billingMode} fill={MODE_COLORS[row.billingMode] ?? '#64748b'} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => money(value, platformCurrency)} />
                </PieChart>
              </ResponsiveContainer>
            </section>
          </div>

          <section className="finance-overview-panel">
            <div className="finance-overview-panel-head">
              <h2>产品拆分</h2>
              <Typography.Text type="secondary">按净收入排序，展示前 10 个产品</Typography.Text>
            </div>
            <DataTable
              rowKey={(row) => row.productId
                ? `product:${row.productId}`
                : `unbound:${row.billingMode}`}
              columns={productColumns}
              dataSource={topProducts}
              searchable
              searchPlaceholder="搜索产品名称 / Slug"
              pagination={false}
              size="small"
              scroll={{ x: 'max-content' }}
            />
          </section>

          <div className="finance-overview-notes">
            {(data?.notes ?? []).map((note) => (
              <Typography.Text key={note} type="secondary">{note}</Typography.Text>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
