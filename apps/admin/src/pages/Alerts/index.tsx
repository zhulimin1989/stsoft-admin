import { useCallback, useMemo, useState } from 'react';
import { Button, Select, DatePicker, Form, Input, message } from 'antd';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
  PageHeader,
  StatCard,
  StatCardGroup,
  FilterBar,
  DataTable,
  Tag,
  DetailDrawer,
  EmptyPlaceholder,
  type TagVariant,
} from '../../components/common';
import { alertApi, type Alert } from '../../api/v2';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { usePermission } from '../../hooks/usePermission';

dayjs.extend(relativeTime);

const { RangePicker } = DatePicker;

const CATEGORY_OPTIONS = [
  { value: 'all', label: '全部类型' },
  { value: 'PAYMENT', label: '支付' },
  { value: 'CHANNEL', label: '渠道' },
  { value: 'USAGE', label: '用量' },
  { value: 'SECURITY', label: '安全' },
  { value: 'SYSTEM', label: '系统' },
];

const SEVERITY_OPTIONS = [
  { value: 'all', label: '全部严重度' },
  { value: 'CRITICAL', label: '严重' },
  { value: 'HIGH', label: '高' },
  { value: 'MEDIUM', label: '中' },
  { value: 'LOW', label: '低' },
];

const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'PENDING', label: '未读' },
  { value: 'READ', label: '已读' },
  { value: 'HANDLED', label: '已处理' },
];

const CATEGORY_LABEL: Record<Alert['category'], string> = {
  PAYMENT: '支付',
  CHANNEL: '渠道',
  USAGE: '用量',
  SECURITY: '安全',
  SYSTEM: '系统',
};

const SEVERITY_LABEL: Record<Alert['severity'], string> = {
  CRITICAL: '严重',
  HIGH: '高',
  MEDIUM: '中',
  LOW: '低',
};

const SEVERITY_DOT: Record<Alert['severity'], string> = {
  CRITICAL: 'var(--err, #dc2626)',
  HIGH: 'var(--warn, #d97706)',
  MEDIUM: 'var(--text-muted, #999)',
  LOW: 'var(--text-muted, #999)',
};

const SEVERITY_VARIANT: Record<Alert['severity'], TagVariant> = {
  CRITICAL: 'error',
  HIGH: 'warn',
  MEDIUM: 'muted',
  LOW: 'muted',
};

const STATUS_LABEL: Record<Alert['status'], string> = {
  PENDING: '未读',
  READ: '已读',
  HANDLED: '已处理',
};
const STATUS_VARIANT: Record<Alert['status'], TagVariant> = {
  PENDING: 'warn',
  READ: 'proc',
  HANDLED: 'success',
};

interface AlertRow extends Alert {
  ruleName?: string;
}

function parseContext(context: Alert['context']): Record<string, unknown> {
  if (!context) return {};
  if (typeof context !== 'string') return context;
  try {
    const parsed = JSON.parse(context);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return { raw: context };
  }
}

const STUB_TODOS = [
  'AlertEvent 表与 /admin/v2/alerts 列表接口',
  '同类告警聚合接口',
  '告警详情上下文与处理记录接口',
];

function isNotFoundError(error: unknown): boolean {
  return (error as { response?: { status?: number } })?.response?.status === 404;
}

interface AlertListMeta {
  stubMode: boolean;
}

export default function AlertsPage() {
  const canManage = usePermission('admin.page.alerts.manage');
  const [stubMode, setStubMode] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [status, setStatus] = useState('all');
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [activeRow, setActiveRow] = useState<AlertRow | null>(null);
  const [handleForm] = Form.useForm<{ handledNote: string }>();

  const alerts = usePaginatedList<AlertRow, AlertListMeta>({
    pageSize: 20,
    deps: [
      search,
      category,
      severity,
      status,
      range?.[0]?.valueOf(),
      range?.[1]?.valueOf(),
    ],
    clearOnError: true,
    onError: (error) => {
      if (isNotFoundError(error)) {
        setStubMode(true);
        return;
      }
      message.error('加载告警列表失败');
    },
    onSuccess: ({ meta }) => {
      if (meta) setStubMode(meta.stubMode);
    },
    fetcher: useCallback(async ({ page, pageSize }) => {
      const res = await alertApi.list({
        page,
        pageSize,
        search: search || undefined,
        category: category === 'all' ? undefined : category,
        severity: severity === 'all' ? undefined : severity,
        status: status === 'all' ? undefined : status,
        fromDate: range?.[0]?.startOf('day').toISOString(),
        toDate: range?.[1]?.endOf('day').toISOString(),
      });
      const payload = res as { items?: AlertRow[]; total?: number };
      return {
        items: payload.items || [],
        total: payload.total || 0,
        page,
        pageSize,
        meta: { stubMode: false },
      };
    }, [category, range, search, severity, status]),
  });

  const stats = useMemo(() => {
    const items = alerts.items;
    const pending = items.filter((r) => r.status === 'PENDING').length;
    const critical = items.filter((r) => r.severity === 'CRITICAL').length;
    const recent24h = items.filter(
      (r) => dayjs().diff(dayjs(r.createdAt), 'hour') < 24,
    ).length;

    const handled = items.filter(
      (r) => r.status === 'HANDLED' && r.handledAt,
    );
    const avgMs =
      handled.length > 0
        ? handled.reduce(
            (acc, r) =>
              acc + dayjs(r.handledAt!).diff(dayjs(r.createdAt), 'minute'),
            0,
          ) / handled.length
        : 0;
    const avgText =
      avgMs > 0 ? `${avgMs.toFixed(0)} 分钟` : handled.length === 0 ? '—' : '0 分钟';

    // Top repeated subject
    const counts = new Map<string, number>();
    items.forEach((r) => counts.set(r.title, (counts.get(r.title) ?? 0) + 1));
    let topTitle = '—';
    let topCount = 0;
    counts.forEach((v, k) => {
      if (v > topCount) {
        topCount = v;
        topTitle = k;
      }
    });
    const topText = topCount > 1 ? `${topCount}× ${topTitle}` : '—';

    return { pending, critical, recent24h, avgText, topText };
  }, [alerts.items]);

  const handleMarkAllRead = async () => {
    try {
      const ids = alerts.items.filter((r) => r.status === 'PENDING').map((r) => r.id);
      if (ids.length === 0) {
        message.info('当前页没有未读告警');
        return;
      }
      await alertApi.markRead(ids);
      message.success(`当前页 ${ids.length} 条告警已标记为已读`);
      alerts.reload();
    } catch {
      message.error('操作失败');
    }
  };

  const handleHandleSubmit = async () => {
    if (!activeRow) return;
    const values = await handleForm.validateFields();
    try {
      await alertApi.handle(activeRow.id, values.handledNote);
      message.success('已标记处理');
      setActiveRow(null);
      handleForm.resetFields();
      alerts.reload();
    } catch {
      message.error('处理失败');
    }
  };

  const columns = [
    {
      title: '时间',
      key: 'time',
      width: 120,
      render: (_: unknown, r: AlertRow) => dayjs(r.createdAt).fromNow(),
    },
    {
      title: '类型',
      key: 'category',
      width: 90,
      render: (_: unknown, r: AlertRow) => (
        <Tag variant="muted">{CATEGORY_LABEL[r.category]}</Tag>
      ),
    },
    {
      title: '告警',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (_: string, r: AlertRow) => (
        <div>
          <div style={{ fontWeight: 500 }}>{r.title}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{r.message}</div>
        </div>
      ),
    },
    {
      title: '严重度',
      key: 'severity',
      width: 100,
      render: (_: unknown, r: AlertRow) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: SEVERITY_DOT[r.severity],
              display: 'inline-block',
            }}
          />
          {SEVERITY_LABEL[r.severity]}
        </span>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 100,
      render: (_: unknown, r: AlertRow) => (
        <Tag variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Tag>
      ),
    },
    {
      title: '处理人',
      key: 'handledBy',
      width: 140,
      render: (_: unknown, r: AlertRow) =>
        r.handledBy ?? <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      align: 'right' as const,
      render: (_: unknown, r: AlertRow) => (
        <div style={{ display: 'inline-flex', gap: 4 }}>
          <Button size="small" type="link" onClick={() => setActiveRow(r)}>
            查看
          </Button>
          {canManage && r.status !== 'HANDLED' && (
            <Button size="small" type="link" onClick={() => setActiveRow(r)}>
              处理
            </Button>
          )}
        </div>
      ),
    },
  ];

  const drawerTabs = activeRow
    ? [
        {
          key: 'basic',
          label: '基本信息',
          content: (
            <div style={{ fontSize: 13, lineHeight: 2 }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>发生时间：</span>
                {dayjs(activeRow.createdAt).format('YYYY-MM-DD HH:mm:ss')}
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>类型：</span>
                {CATEGORY_LABEL[activeRow.category]}
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>严重度：</span>
                {SEVERITY_LABEL[activeRow.severity]}
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>标题：</span>
                {activeRow.title}
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>详情：</span>
                {activeRow.message}
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>来源：</span>
                {activeRow.sourceType || activeRow.sourceId
                  ? `${activeRow.sourceType ?? 'unknown'}${activeRow.sourceId ? ` / ${activeRow.sourceId}` : ''}`
                  : '—'}
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>用户：</span>
                {activeRow.userId ?? '—'}
              </div>
              {Object.keys(parseContext(activeRow.context)).length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ color: 'var(--text-muted)' }}>详细上下文：</div>
                  <pre
                    style={{
                      background: 'var(--bg-elev, #f7f8fa)',
                      padding: 8,
                      borderRadius: 6,
                      fontSize: 12,
                      maxHeight: 280,
                      overflow: 'auto',
                    }}
                  >
                    {JSON.stringify(parseContext(activeRow.context), null, 2)}
                  </pre>
                </div>
              )}
              {activeRow.handleNote && (
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>处理备注：</span>
                  {activeRow.handleNote}
                </div>
              )}
            </div>
          ),
        },
        ...(canManage
          ? [
              {
                key: 'action',
                label: '操作',
                content: activeRow.status === 'HANDLED' ? (
                  <div style={{ color: 'var(--text-muted)' }}>该告警已处理。</div>
                ) : (
                  <Form form={handleForm} layout="vertical">
                    <Form.Item
                      name="handledNote"
                      label="处理备注"
                      rules={[{ required: true, message: '请填写处理说明' }]}
                    >
                      <Input.TextArea
                        rows={5}
                        placeholder="处理过程、根因分析、后续动作..."
                      />
                    </Form.Item>
                    <Button
                      type="primary"
                      onClick={handleHandleSubmit}
                    >
                      标记为已处理
                    </Button>
                  </Form>
                ),
              },
            ]
          : []),
      ]
    : [];

  const pageActions =
    canManage && !stubMode && stats.pending > 0
      ? [
          <Button key="markAll" onClick={handleMarkAllRead}>
            标记当前页已读
          </Button>,
        ]
      : [];

  return (
    <div>
      <PageHeader
        title="告警中心"
        subtitle="系统告警 + 业务异常统一处理"
        actions={pageActions}
      />

      <StatCardGroup columns={5}>
        <StatCard
          label="未读"
          value={stats.pending}
          variant={stats.pending > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="严重 (CRITICAL)"
          value={stats.critical}
          variant={stats.critical > 0 ? 'error' : 'default'}
        />
        <StatCard label="24h 内新增" value={stats.recent24h} />
        <StatCard label="平均处理时长" value={stats.avgText} />
        <StatCard label="重复 Top 1" value={stats.topText} />
      </StatCardGroup>

      <FilterBar
        search={{
          placeholder: '搜索主体 / 备注',
          onSearch: (v) => {
            setSearch(v);
          },
        }}
        filters={[
          <Select
            key="cat"
            value={category}
            style={{ width: 130 }}
            onChange={(v) => {
              setCategory(v);
            }}
            options={CATEGORY_OPTIONS}
          />,
          <Select
            key="sev"
            value={severity}
            style={{ width: 130 }}
            onChange={(v) => {
              setSeverity(v);
            }}
            options={SEVERITY_OPTIONS}
          />,
          <Select
            key="st"
            value={status}
            style={{ width: 130 }}
            onChange={(v) => {
              setStatus(v);
            }}
            options={STATUS_OPTIONS}
          />,
          <RangePicker
            key="range"
            value={range}
            onChange={(values) => {
              setRange(
                values && values[0] && values[1]
                  ? ([values[0], values[1]] as [dayjs.Dayjs, dayjs.Dayjs])
                  : null,
              );
            }}
          />,
        ]}
      />

      {stubMode ? (
        <EmptyPlaceholder
          title="后端接口待就绪"
          description="告警中心后端 API 尚未上线。"
          todos={STUB_TODOS}
        />
      ) : (
        <DataTable<AlertRow>
          columns={columns}
          dataSource={alerts.items}
          rowKey="id"
          loading={alerts.loading}
          listPagination={alerts.tablePagination}
          scroll={{ x: 1200 }}
        />
      )}

      <DetailDrawer
        open={!!activeRow}
        onClose={() => {
          setActiveRow(null);
          handleForm.resetFields();
        }}
        title={activeRow?.title ?? '告警详情'}
        subtitle={
          activeRow
            ? `${CATEGORY_LABEL[activeRow.category]} · ${SEVERITY_LABEL[activeRow.severity]}`
            : undefined
        }
        status={
          activeRow ? (
            <Tag variant={SEVERITY_VARIANT[activeRow.severity]}>
              {STATUS_LABEL[activeRow.status]}
            </Tag>
          ) : null
        }
        tabs={drawerTabs}
      />
    </div>
  );
}
