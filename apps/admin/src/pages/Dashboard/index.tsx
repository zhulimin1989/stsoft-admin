import { useEffect, useState } from 'react';
import { Alert, Segmented, Spin } from 'antd';
import { PageHeader, StatCard, StatCardGroup, MetricChart } from '../../components/common';
import { dashboardApi, type AdminDashboardOverview, type AdminDashboardPeriod, type AdminDashboardTrendPoint } from '../../api/admin';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { formatCurrencyCents } from '../../utils/price';
import './Dashboard.css';

const PERIOD_OPTIONS: Array<{ label: string; value: AdminDashboardPeriod }> = [
  { label: '7天', value: 'sevenDays' },
  { label: '月度', value: 'month' },
  { label: '年度', value: 'year' },
];

export default function DashboardPage() {
  const platformCurrency = usePlatformCurrency();
  const [overview, setOverview] = useState<AdminDashboardOverview | null>(null);
  const [period, setPeriod] = useState<AdminDashboardPeriod>('sevenDays');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    dashboardApi
      .overview()
      .then((data) => {
        if (mounted) setOverview(data);
      })
      .catch((err: unknown) => {
        if (mounted) {
          console.warn('[dashboard] overview load failed', err);
          setError('运营总览加载失败，请稍后重试。');
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!overview) {
    return (
      <div>
        <PageHeader title="运营总览" subtitle="全平台用户增长与收款情况" />
        <Alert type="error" showIcon message={error ?? '运营总览加载失败'} />
      </div>
    );
  }

  const userTrend = overview.users.trends[period] ?? [];
  const paymentTrend = toMajorUnitTrend(overview.payments.trends[period] ?? []);
  const topProductRevenue = overview.payments.productBreakdown[0]?.totalRevenueCents ?? 0;
  const periodLabel = PERIOD_OPTIONS.find((item) => item.value === period)?.label ?? '7天';
  const userStatsAvailable = overview.users.available !== false;

  return (
    <div>
      <PageHeader
        title="运营总览"
        subtitle="全平台用户增长与收款情况"
      />

      <StatCardGroup columns={4}>
        <StatCard label="总用户数量" value={overview.users.totalUsers} />
        <StatCard
          label="今日新增用户"
          value={userStatsAvailable ? overview.users.todayNewUsers : '暂不可用'}
          variant={userStatsAvailable ? 'success' : 'warning'}
        />
        <StatCard
          label="今日收款"
          value={overview.payments.available ? formatCurrencyCents(overview.payments.todayRevenueCents, platformCurrency) : '无权限'}
          variant={overview.payments.available ? 'success' : 'warning'}
        />
        <StatCard
          label="累计收款"
          value={overview.payments.available ? formatCurrencyCents(overview.payments.totalRevenueCents, platformCurrency) : '无权限'}
        />
      </StatCardGroup>

      {!userStatsAvailable && (
        <Alert
          className="rt-dashboard-alert"
          type="warning"
          showIcon
          message="用户新增统计暂不可用，已展示可获取的用户总数。"
        />
      )}

      {!overview.payments.available && (
        <Alert
          className="rt-dashboard-alert"
          type="warning"
          showIcon
          message="当前账号缺少财务可见权限，收款趋势与产品收款暂不可用。"
        />
      )}

      <div className="rt-dashboard-period">
        <Segmented
          size="small"
          value={period}
          options={PERIOD_OPTIONS}
          onChange={(value) => setPeriod(value as AdminDashboardPeriod)}
        />
      </div>

      <div className="rt-dash-2col">
        <section className="rt-panel">
          <header>
            <h3>用户增量趋势</h3>
            <span className="rt-panel-sub">{periodLabel}</span>
          </header>
          <MetricChart data={userTrend} dataKey="value" height={220} />
        </section>

        <section className="rt-panel">
          <header>
            <h3>收款趋势</h3>
            <span className="rt-panel-sub">{periodLabel} · {platformCurrency.toUpperCase()}</span>
          </header>
          <MetricChart data={paymentTrend} dataKey="value" height={220} color="#2F7D68" />
        </section>
      </div>

      <section className="rt-panel rt-dashboard-products">
        <header>
          <h3>按产品维度收款</h3>
          <span className="rt-panel-sub">按累计收款排序</span>
        </header>

        {overview.payments.productBreakdown.length === 0 ? (
          <div className="rt-list-placeholder">暂无产品收款数据</div>
        ) : (
          <div className="rt-product-revenue-list">
            {overview.payments.productBreakdown.map((product) => {
              const share = productRevenueShare(product.totalRevenueCents, topProductRevenue);
              return (
                <div className="rt-product-revenue-row" key={product.productId}>
                  <div className="rt-product-revenue-main">
                    <div className="rt-product-revenue-name">{product.productName}</div>
                    <div className="rt-product-revenue-meta">
                      {product.productSlug || product.productId}
                      {product.billingMode ? ` · ${product.billingMode}` : ''}
                    </div>
                  </div>
                  <div className="rt-product-revenue-bar" aria-hidden="true">
                    <span style={{ width: `${share}%` }} />
                  </div>
                  <div className="rt-product-revenue-money">
                    <div>{formatCurrencyCents(product.totalRevenueCents, platformCurrency)}</div>
                    <span>今日 {formatCurrencyCents(product.todayRevenueCents, platformCurrency)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function toMajorUnitTrend(data: AdminDashboardTrendPoint[]) {
  return data.map((point) => ({
    ...point,
    value: Number((point.value / 100).toFixed(2)),
  }));
}

export function productRevenueShare(totalRevenueCents: number, topProductRevenueCents: number) {
  if (totalRevenueCents <= 0 || topProductRevenueCents <= 0) return 0;
  return Math.max(3, Math.round(totalRevenueCents / topProductRevenueCents * 100));
}
