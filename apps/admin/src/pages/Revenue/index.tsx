import { useState, useEffect } from 'react';
import { Card, Col, Row, Statistic, Typography, Spin, message } from 'antd';
import {
  DollarOutlined,
  UserOutlined,
  RiseOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { revenueApi } from '../../api/admin';
import { PageHeader, StatCard, StatCardGroup } from '../../components/common';

interface RevenueData {
  totalConsumedCredits: number;
  activeUsers: number;
  mrr: number;
  arpu: number;
  modelUsage: Array<{ model: string; consumed: number; count: number }>;
  tierDistribution: Array<{ tierId: string; count: number; mrr: number }>;
}

const PIE_COLORS = ['#1a1a1a', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#06b6d4', '#ec4899', '#f97316'];

export default function RevenuePage() {
  const [data, setData] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    revenueApi
      .overview({ days: 30 })
      .then(setData)
      .catch(() => {
        message.error('加载收入分析失败');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }

  if (!data) {
    return <Typography.Text type="secondary">加载失败</Typography.Text>;
  }

  const modelUsageData = (data.modelUsage || []).map((item) => ({
    name: item.model,
    value: item.consumed,
  }));

  const tierData = (data.tierDistribution || []).map((item) => ({
    name: item.tierId,
    count: item.count,
  }));

  return (
    <div>
      <PageHeader
        title="收入分析"
        subtitle="按计费模式 + 按产品拆分 · 近 30 天"
      />

      {/* TODO(Phase 3 fill-in): wire 订阅收入 / CodingPlan 收入 / 按量收入 to
          real numbers — requires either a backend aggregation API
          (e.g. revenueApi.byBillingMode) or the Product.billingMode field
          plus client-side grouping over orders. For now placeholder "—". */}
      <StatCardGroup columns={3}>
        <StatCard label="订阅收入" value="—" />
        <StatCard label="CodingPlan 收入" value="—" />
        <StatCard label="按量收入" value="—" />
      </StatCardGroup>

      <h2 style={{ marginTop: 24, marginBottom: 24, fontSize: 20, fontWeight: 600 }}>
        <DollarOutlined /> 营收概览
      </h2>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false}>
            <Statistic
              title="总消耗额度"
              value={data.totalConsumedCredits}
              prefix={<ThunderboltOutlined />}
              valueStyle={{ color: '#1a1a1a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false}>
            <Statistic
              title="活跃用户"
              value={data.activeUsers}
              prefix={<UserOutlined />}
              valueStyle={{ color: '#10b981' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false}>
            <Statistic
              title="MRR"
              value={data.mrr}
              prefix={<DollarOutlined />}
              precision={2}
              valueStyle={{ color: '#f59e0b' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false}>
            <Statistic
              title="ARPU"
              value={data.arpu}
              prefix={<RiseOutlined />}
              precision={2}
              valueStyle={{ color: '#6366f1' }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title="模型使用分布" bordered={false}>
            {modelUsageData.length > 0 ? (
              <ResponsiveContainer width="100%" height={320} minWidth={0}>
                <PieChart>
                  <Pie
                    data={modelUsageData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={110}
                    label={({ name, percent }: { name?: string; percent?: number }) =>
                      `${name ?? ''} ${((percent ?? 0) * 100).toFixed(1)}%`
                    }
                  >
                    {modelUsageData.map((item, index) => (
                      <Cell key={item.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => [`${Number(value).toLocaleString()}`, '消耗额度']} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <Typography.Text type="secondary">暂无数据</Typography.Text>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="套餐分布" bordered={false}>
            {tierData.length > 0 ? (
              <ResponsiveContainer width="100%" height={320} minWidth={0}>
                <BarChart data={tierData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip formatter={(value) => [`${value}`, '用户数']} />
                  <Bar dataKey="count" fill="#1a1a1a" radius={[4, 4, 0, 0]} name="用户数" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Typography.Text type="secondary">暂无数据</Typography.Text>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
