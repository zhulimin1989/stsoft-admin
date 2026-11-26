import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Select, Space, Tooltip } from 'antd';
import type { TableColumnsType } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  DataTable,
  PageHeader,
  StatCard,
  StatCardGroup,
  Tag,
  type TagVariant,
} from '../../components/common';
import {
  agentObservabilityApi,
  type AgentObservabilityBreakdownItem,
  type AgentObservabilityRecentFailure,
  type AgentObservabilitySummary,
} from '../../api/admin';
import './AgentObservability.css';

const DAY_OPTIONS = [
  { label: '1 天', value: 1 },
  { label: '3 天', value: 3 },
  { label: '7 天', value: 7 },
  { label: '14 天', value: 14 },
  { label: '30 天', value: 30 },
];

const STATUS_LABELS: Record<string, string> = {
  completed: '完成',
  continuable: '可续跑',
  needs_attention: '需介入',
  failed: '失败',
  running: '运行中',
  pending: '等待中',
};

function pct(value: number | undefined): string {
  return `${Number(value || 0).toFixed(1)}%`;
}

function compact(value: string | null | undefined, fallback = '—'): string {
  if (!value) return fallback;
  return value.length > 36 ? `${value.slice(0, 33)}...` : value;
}

function statusVariant(status: string): TagVariant {
  if (status === 'completed') return 'success';
  if (status === 'continuable' || status === 'running') return 'proc';
  if (status === 'needs_attention') return 'warn';
  if (status === 'failed') return 'error';
  return 'muted';
}

function BreakdownPanel({
  title,
  items,
  emptyText = '暂无数据',
}: {
  title: string;
  items: AgentObservabilityBreakdownItem[];
  emptyText?: string;
}) {
  const max = Math.max(...items.map((item) => item.count), 1);
  return (
    <section className="rt-agent-obs-panel">
      <div className="rt-agent-obs-panel-title">{title}</div>
      {items.length === 0 ? (
        <div className="rt-agent-obs-empty">{emptyText}</div>
      ) : (
        <div className="rt-agent-obs-bars">
          {items.map((item) => (
            <div className="rt-agent-obs-bar-row" key={item.key}>
              <div className="rt-agent-obs-bar-meta">
                <span title={item.key}>{item.key}</span>
                <span>{item.count.toLocaleString('zh-CN')}</span>
              </div>
              <div className="rt-agent-obs-bar-track">
                <div
                  className="rt-agent-obs-bar-fill"
                  style={{ width: `${Math.max((item.count / max) * 100, 4)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function AgentObservabilityPage() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<AgentObservabilitySummary | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await agentObservabilityApi.summary({ days, recentLimit: 20 });
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const columns = useMemo<TableColumnsType<AgentObservabilityRecentFailure>>(
    () => [
      {
        title: '项目',
        dataIndex: 'projectName',
        width: 210,
        render: (_, row) => (
          <div className="rt-agent-obs-project">
            <div>{row.projectName || '未命名项目'}</div>
            <span>{compact(row.projectId)}</span>
          </div>
        ),
      },
      {
        title: '状态',
        dataIndex: 'status',
        width: 96,
        render: (status: string) => (
          <Tag variant={statusVariant(status)}>
            {STATUS_LABELS[status] || status}
          </Tag>
        ),
      },
      {
        title: '停止原因',
        dataIndex: 'stopReason',
        width: 190,
        render: (value: string | null) => (
          <span className="rt-agent-obs-code">{compact(value)}</span>
        ),
      },
      {
        title: '失败原因',
        dataIndex: 'failureCode',
        width: 190,
        render: (_, row) => {
          const label =
            row.failureCode ||
            row.topErrorCode ||
            (row.toolErrorsTotal > 0 ? 'TOOL_ERROR_UNCLASSIFIED' : '—');
          return (
            <Tooltip
              title={row.failureMessage || row.errorMessage || undefined}
            >
              <span className="rt-agent-obs-code">{label}</span>
            </Tooltip>
          );
        },
      },
      {
        title: 'Harness',
        dataIndex: 'harnessVariantId',
        width: 190,
        render: (value: string | null) => (
          <span className="rt-agent-obs-code">{compact(value)}</span>
        ),
      },
      {
        title: '时间',
        dataIndex: 'completedAt',
        width: 130,
        render: (_, row) => {
          const value = row.completedAt || row.createdAt;
          return value ? dayjs(value).format('MM-DD HH:mm') : '—';
        },
      },
    ],
    [],
  );

  const kpis = data?.kpis;
  const rates = data?.rates;
  const subtitle = data?.window?.to
    ? `近 ${data.window.days || days} 天 · 截止 ${dayjs(data.window.to).format('MM-DD HH:mm')}`
    : `近 ${days} 天`;

  return (
    <div className="rt-agent-obs">
      <PageHeader
        title="Agent 观测"
        subtitle={subtitle}
        actions={[
          <Space key="filters" size={8}>
            <Select
              value={days}
              options={DAY_OPTIONS}
              onChange={setDays}
              style={{ width: 96 }}
            />
            <Button
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={fetchData}
            >
              刷新
            </Button>
          </Space>,
        ]}
      />

      {data?.unavailable && (
        <Alert
          type="warning"
          showIcon
          className="rt-agent-obs-alert"
          message="Agent 指标暂不可用"
          description={data.message || data.reason || 'admin API 未能读取 SaaS 指标。'}
        />
      )}

      <StatCardGroup columns={6}>
        <StatCard label="执行轮次" value={kpis?.totalRuns ?? 0} />
        <StatCard
          label="失败/需介入"
          value={kpis?.failedOrNeedsAttentionRuns ?? 0}
          variant={(kpis?.failedOrNeedsAttentionRuns ?? 0) > 0 ? 'error' : 'default'}
        />
        <StatCard
          label="No Progress"
          value={kpis?.noProgressRuns ?? 0}
          variant={(kpis?.noProgressRuns ?? 0) > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="IAB/预览相关"
          value={kpis?.iabRelatedRuns ?? 0}
          variant={(kpis?.iabRelatedRuns ?? 0) > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="续跑死信"
          value={kpis?.continuationDeadLetters ?? 0}
          variant={(kpis?.continuationDeadLetters ?? 0) > 0 ? 'error' : 'default'}
        />
        <StatCard
          label="Subagent 失败率"
          value={pct(rates?.subagentFailureRate)}
          variant={(rates?.subagentFailureRate ?? 0) > 0 ? 'error' : 'default'}
        />
      </StatCardGroup>

      <div className="rt-agent-obs-grid rt-agent-obs-grid-3">
        <BreakdownPanel
          title="失败原因 Code"
          items={data?.breakdowns.failureReasons ?? []}
        />
        <BreakdownPanel
          title="工具错误 Code"
          items={data?.breakdowns.toolErrorCodes ?? []}
        />
        <BreakdownPanel
          title="错误归因"
          items={data?.breakdowns.failureBlame ?? data?.breakdowns.toolErrorBlame ?? []}
        />
      </div>

      <div className="rt-agent-obs-grid rt-agent-obs-grid-3">
        <BreakdownPanel
          title="Stop Reason"
          items={data?.breakdowns.stopReasons ?? []}
        />
        <BreakdownPanel
          title="Continuation"
          items={data?.breakdowns.continuationStatuses ?? []}
        />
        <BreakdownPanel
          title="Harness Variant"
          items={data?.breakdowns.harnessVariants ?? []}
        />
      </div>

      <div className="rt-agent-obs-grid rt-agent-obs-grid-2">
        <BreakdownPanel
          title="Subagent Profile"
          items={data?.breakdowns.subagentProfiles ?? []}
        />
        <BreakdownPanel
          title="Subagent 错误"
          items={data?.breakdowns.subagentErrorCodes ?? []}
        />
      </div>

      <section className="rt-agent-obs-panel">
        <div className="rt-agent-obs-table-head">
          <div className="rt-agent-obs-panel-title">近期失败与需介入执行</div>
          <div className="rt-agent-obs-muted">
            失败率 {pct(rates?.failureRate)} · No Progress {pct(rates?.noProgressRate)}
          </div>
        </div>
        <DataTable<AgentObservabilityRecentFailure>
          rowKey="runId"
          size="small"
          loading={loading && !data}
          columns={columns}
          dataSource={data?.recentFailures ?? []}
          searchable
          searchPlaceholder="搜索执行 ID / 用户 / 错误"
          pagination={false}
          scroll={{ x: 980 }}
        />
      </section>
    </div>
  );
}
