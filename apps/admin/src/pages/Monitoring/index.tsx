import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Button,
  Modal,
  Form,
  Input,
  Select,
  Popconfirm,
  message,
} from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
  PageHeader,
  StatCard,
  StatCardGroup,
  EmptyPlaceholder,
  StableNumberInput,
  Tag,
  type TagVariant,
} from '../../components/common';
import { monitoringApi } from '../../api/admin';
import { usePermission } from '../../hooks/usePermission';

dayjs.extend(relativeTime);

interface ChannelHealth {
  name: string;
  provider: string;
  status: string;
  successRate: number;
  totalReqs: number;
  totalErrs: number;
  avgLatencyMs: number;
}

interface AlertRule {
  id: string;
  name: string;
  metric: string;
  condition: string;
  threshold: number;
  windowMinutes: number;
  isActive: boolean;
}

const STATUS_DOT: Record<string, { color: string; label: string }> = {
  healthy: { color: 'var(--ok, #16a34a)', label: '健康' },
  active: { color: 'var(--ok, #16a34a)', label: '健康' },
  degraded: { color: 'var(--warn, #d97706)', label: '降级' },
  down: { color: 'var(--err, #dc2626)', label: '故障' },
  inactive: { color: 'var(--text-muted, #999)', label: '未启用' },
  unknown: { color: 'var(--text-muted, #999)', label: '未知' },
};

const METRIC_OPTIONS = [
  { label: '错误率', value: 'error_rate' },
  { label: '延迟 (ms)', value: 'latency_ms' },
  { label: '请求量', value: 'request_count' },
  { label: '成功率', value: 'success_rate' },
];

const CONDITION_OPTIONS = [
  { label: '大于', value: 'gt' },
  { label: '小于', value: 'lt' },
  { label: '大于等于', value: 'gte' },
  { label: '小于等于', value: 'lte' },
];

const WINDOW_OPTIONS = [
  { label: '1 分钟', value: 1 },
  { label: '5 分钟', value: 5 },
  { label: '15 分钟', value: 15 },
  { label: '1 小时', value: 60 },
];

const cardStyle: React.CSSProperties = {
  background: 'var(--surface, #fff)',
  border: '1px solid var(--border, #e5e7eb)',
  borderRadius: 8,
  padding: 16,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
};

const cardTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  marginBottom: 12,
  color: 'var(--text)',
};

export default function MonitoringPage() {
  const canManageAlerts = usePermission('admin.page.monitoring.manage');
  const [healthData, setHealthData] = useState<ChannelHealth[]>([]);
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [healthLoading, setHealthLoading] = useState(false);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();

  const fetchHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const res = await monitoringApi.channelHealth();
      setHealthData(res?.items || res || []);
    } catch {
      // tolerate – show empty
      setHealthData([]);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const fetchAlerts = useCallback(async () => {
    setAlertsLoading(true);
    try {
      const res = await monitoringApi.alertList();
      setAlerts(res?.items || res || []);
    } catch {
      setAlerts([]);
    } finally {
      setAlertsLoading(false);
    }
  }, []);

  const refreshAll = useCallback(() => {
    fetchHealth();
    fetchAlerts();
  }, [fetchHealth, fetchAlerts]);

  useEffect(() => {
    refreshAll();
    const t = setInterval(refreshAll, 30_000);
    return () => clearInterval(t);
  }, [refreshAll]);

  const handleDeleteAlert = async (id: string) => {
    try {
      await monitoringApi.alertDelete(id);
      message.success('规则已删除');
      fetchAlerts();
    } catch {
      message.error('删除失败');
    }
  };

  const handleCreateAlert = async () => {
    const values = await form.validateFields();
    try {
      await monitoringApi.alertCreate({
        ...values,
        windowMinutes: values.windowMinutes ?? 5,
      });
      message.success('告警规则创建成功');
      setModalOpen(false);
      form.resetFields();
      fetchAlerts();
    } catch {
      message.error('创建失败');
    }
  };

  // Aggregate top-line stats from channel health
  const stats = useMemo(() => {
    const reqs = healthData.reduce((a, r) => a + (r.totalReqs ?? 0), 0);
    const errs = healthData.reduce((a, r) => a + (r.totalErrs ?? 0), 0);
    const latencies = healthData.map((r) => r.avgLatencyMs).filter(Boolean);
    const errRate = reqs > 0 ? ((errs / reqs) * 100).toFixed(2) + '%' : '—';
    const p95 =
      latencies.length > 0
        ? `${Math.round(latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)] ?? 0)}ms`
        : '—';
    return {
      online: '—',
      qps: reqs > 0 ? `${(reqs / 60).toFixed(1)}/s` : '—',
      p95,
      errRate,
      tokens: '—',
    };
  }, [healthData]);

  const alertTagVariant = (active: boolean): TagVariant =>
    active ? 'warn' : 'muted';

  return (
    <div>
      <PageHeader
        title="实时监控"
        subtitle="近 1 小时数据 · 30 秒自动刷新"
        actions={[
          <Button
            key="refresh"
            icon={<ReloadOutlined />}
            onClick={refreshAll}
            loading={healthLoading || alertsLoading}
          >
            刷新
          </Button>,
          canManageAlerts ? (
            <Button
              key="add"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                form.resetFields();
                form.setFieldsValue({ windowMinutes: 5 });
                setModalOpen(true);
              }}
            >
              新建告警
            </Button>
          ) : null,
        ].filter(Boolean)}
      />

      <StatCardGroup columns={5}>
        <StatCard label="在线用户" value={stats.online} />
        <StatCard label="QPS" value={stats.qps} />
        <StatCard label="P95 延迟" value={stats.p95} />
        <StatCard
          label="错误率"
          value={stats.errRate}
          variant={
            stats.errRate !== '—' && parseFloat(stats.errRate) > 1
              ? 'error'
              : 'default'
          }
        />
        <StatCard label="Token 流量" value={stats.tokens} />
      </StatCardGroup>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 16,
          marginTop: 16,
        }}
      >
        {/* 实时请求流 */}
        <div style={cardStyle}>
          <div style={cardTitle}>实时请求流</div>
          <div style={{ flex: 1, overflow: 'auto', maxHeight: 480 }}>
            <EmptyPlaceholder
              title="实时请求流"
              description="近实时请求采样,自动滚动,最多 50 条。"
              todos={['GET /admin/monitoring/recent-requests (SSE 或 30s 轮询)']}
            />
          </div>
        </div>

        {/* 当前会话 */}
        <div style={cardStyle}>
          <div style={cardTitle}>当前会话</div>
          <div style={{ flex: 1, overflow: 'auto', maxHeight: 480 }}>
            <EmptyPlaceholder
              title="当前活跃会话"
              description="按用户列出当前正在进行的会话。"
              todos={['GET /admin/monitoring/active-sessions']}
            />
          </div>
        </div>

        {/* 渠道健康度 dot 矩阵 */}
        <div style={cardStyle}>
          <div style={cardTitle}>渠道实时健康度</div>
          {healthData.length === 0 ? (
            <EmptyPlaceholder
              title="暂无渠道数据"
              description="还没有接入的上游渠道,或健康检查未跑。"
            />
          ) : (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                  gap: 8,
                }}
              >
                {healthData.map((c) => {
                  const info =
                    STATUS_DOT[(c.status || '').toLowerCase()] ??
                    STATUS_DOT.unknown;
                  return (
                    <div
                      key={c.name}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 8px',
                        background: 'var(--bg-elev, #f7f8fa)',
                        borderRadius: 4,
                        fontSize: 12,
                      }}
                      title={`${c.name} · ${info.label} · ${
                        c.successRate
                          ? (c.successRate * 100).toFixed(1) + '%'
                          : '—'
                      }`}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: info.color,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {c.name}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div
                style={{
                  marginTop: 16,
                  paddingTop: 12,
                  borderTop: '1px solid var(--border)',
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    marginBottom: 6,
                  }}
                >
                  当前告警规则
                </div>
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                >
                  {alerts.length === 0 ? (
                    <span
                      style={{ color: 'var(--text-muted)', fontSize: 12 }}
                    >
                      暂无规则
                    </span>
                  ) : (
                    alerts.map((a) => (
                      <div
                        key={a.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: 12,
                        }}
                      >
                        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                          <Tag variant={alertTagVariant(a.isActive)}>
                            {a.isActive ? '启用' : '停用'}
                          </Tag>
                          {a.name}
                        </span>
                        {canManageAlerts ? (
                          <Popconfirm
                            title="删除该规则？"
                            onConfirm={() => handleDeleteAlert(a.id)}
                          >
                            <Button size="small" type="link" danger>
                              删除
                            </Button>
                          </Popconfirm>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <Modal
        title="新增告警规则"
        open={modalOpen}
        onOk={handleCreateAlert}
        onCancel={() => setModalOpen(false)}
        okText="创建"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="规则名称"
            rules={[{ required: true, message: '请输入规则名称' }]}
          >
            <Input placeholder="如: OpenAI 错误率告警" />
          </Form.Item>
          <Form.Item
            name="metric"
            label="监控指标"
            rules={[{ required: true, message: '请选择指标' }]}
          >
            <Select options={METRIC_OPTIONS} placeholder="选择指标" />
          </Form.Item>
          <Form.Item
            name="condition"
            label="条件"
            rules={[{ required: true, message: '请选择条件' }]}
          >
            <Select options={CONDITION_OPTIONS} placeholder="选择条件" />
          </Form.Item>
          <Form.Item
            name="threshold"
            label="阈值"
            rules={[{ required: true, message: '请输入阈值' }]}
          >
            <StableNumberInput style={{ width: '100%' }} placeholder="如 0.1" />
          </Form.Item>
          <Form.Item
            name="windowMinutes"
            label="时间窗口"
            rules={[{ required: true, message: '请选择时间窗口' }]}
          >
            <Select options={WINDOW_OPTIONS} placeholder="选择时间窗口" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
