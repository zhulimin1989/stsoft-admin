import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Select, DatePicker, message, Empty, Modal, Input } from 'antd';
import { ExportOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
  PageHeader,
  StatCard,
  StatCardGroup,
  FilterBar,
  DataTable,
  Tag,
  EmptyPlaceholder,
  DetailDrawer,
  type TagVariant,
} from '../../components/common';
import {
  riskUserApi,
  type RiskFlag,
  type RelatedUserItem,
  type RiskAuditLogItem,
} from '../../api/v2';
import type { RiskRuleType } from '../../api/v2';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { usePermission } from '../../hooks/usePermission';

dayjs.extend(relativeTime);

const { RangePicker } = DatePicker;

const RULE_TYPE_OPTIONS = [
  { value: 'all', label: '全部风险类型' },
  { value: 'BLACKLIST', label: '黑名单' },
  { value: 'USAGE_THRESHOLD', label: '异常用量' },
  { value: 'IP_LIMIT', label: 'IP 限制' },
  { value: 'FRAUD_PROVIDER', label: '反欺诈' },
  { value: 'REFUND_RATE', label: '退款率' },
];

const SEVERITY_OPTIONS = [
  { value: 'all', label: '全部严重度' },
  { value: 'HIGH', label: '高' },
  { value: 'MEDIUM', label: '中' },
  { value: 'LOW', label: '低' },
];

const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'PENDING', label: '待审核' },
  { value: 'CONFIRMED', label: '已确认' },
  { value: 'RELEASED', label: '已解封' },
  { value: 'PERMANENT_BAN', label: '永久封禁' },
];

const RULE_TYPE_LABEL: Record<RiskRuleType, string> = {
  BLACKLIST: '黑名单',
  USAGE_THRESHOLD: '异常用量',
  IP_LIMIT: 'IP 限制',
  FRAUD_PROVIDER: '反欺诈',
  REFUND_RATE: '退款率',
};

const SEVERITY_LABEL: Record<RiskFlag['severity'], string> = {
  HIGH: '高',
  MEDIUM: '中',
  LOW: '低',
};
const SEVERITY_DOT: Record<RiskFlag['severity'], string> = {
  HIGH: 'var(--err, #dc2626)',
  MEDIUM: 'var(--warn, #d97706)',
  LOW: 'var(--text-muted, #999)',
};

const STATUS_VARIANT: Record<RiskFlag['status'], TagVariant> = {
  PENDING: 'warn',
  CONFIRMED: 'error',
  RELEASED: 'success',
  PERMANENT_BAN: 'muted',
};
const STATUS_LABEL: Record<RiskFlag['status'], string> = {
  PENDING: '待审核',
  CONFIRMED: '已确认',
  RELEASED: '已解封',
  PERMANENT_BAN: '永久封禁',
};

export default function RiskUsersPage() {
  const [search, setSearch] = useState('');
  const [ruleType, setRuleType] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [status, setStatus] = useState('all');
  const [dateRange, setDateRange] = useState<
    [dayjs.Dayjs | null, dayjs.Dayjs | null] | null
  >(null);
  const [activeRow, setActiveRow] = useState<RiskFlag | null>(null);
  const [releaseTarget, setReleaseTarget] = useState<RiskFlag | null>(null);
  const [banTarget, setBanTarget] = useState<RiskFlag | null>(null);
  const [releaseNote, setReleaseNote] = useState('');
  const [banReason, setBanReason] = useState('');
  const [operating, setOperating] = useState(false);
  const [related, setRelated] = useState<{
    items: RelatedUserItem[];
    mode: 'IP' | 'TODO';
  } | null>(null);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [historyItems, setHistoryItems] = useState<RiskFlag[]>([]);
  const [auditItems, setAuditItems] = useState<RiskAuditLogItem[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const canManage = usePermission('admin.page.risk_users.manage');
  const activeRowId = activeRow?.id;

  const riskFlags = usePaginatedList<RiskFlag>({
    pageSize: 20,
    deps: [
      search,
      ruleType,
      severity,
      status,
      dateRange?.[0]?.valueOf(),
      dateRange?.[1]?.valueOf(),
    ],
    onError: () => message.error('加载风险列表失败'),
    fetcher: useCallback(async ({ page, pageSize }) => {
      const res = await riskUserApi.list({
        page,
        pageSize,
        search: search || undefined,
        ruleType:
          ruleType === 'all' ? undefined : (ruleType as RiskRuleType),
        severity:
          severity === 'all'
            ? undefined
            : (severity as RiskFlag['severity']),
        status:
          status === 'all' ? undefined : (status as RiskFlag['status']),
        triggeredFrom: dateRange?.[0]?.format('YYYY-MM-DD'),
        triggeredTo: dateRange?.[1]?.format('YYYY-MM-DD'),
      });
      return {
        items: res.items,
        total: res.total,
        page,
        pageSize,
      };
    }, [dateRange, ruleType, search, severity, status]),
  });

  // Fetch related users when drawer opens.
  useEffect(() => {
    if (!activeRowId) {
      setRelated(null);
      setHistoryItems([]);
      setAuditItems([]);
      return;
    }
    setRelatedLoading(true);
    setTimelineLoading(true);
    riskUserApi
      .related(activeRowId)
      .then((r) => setRelated(r))
      .catch(() => setRelated({ items: [], mode: 'TODO' }))
      .finally(() => setRelatedLoading(false));
    Promise.all([
      riskUserApi.history(activeRowId),
      riskUserApi.auditLogs(activeRowId),
    ])
      .then(([history, audit]) => {
        setHistoryItems(history.items);
        setAuditItems(audit.items);
      })
      .catch(() => {
        setHistoryItems([]);
        setAuditItems([]);
      })
      .finally(() => setTimelineLoading(false));
  }, [activeRowId]);

  const stats = useMemo(() => {
    const items = riskFlags.items;
    return {
      blacklistCount: items.filter((r) => r.ruleType === 'BLACKLIST').length,
      usage: items.filter((r) => r.ruleType === 'USAGE_THRESHOLD').length,
      fraud: items.filter((r) => r.ruleType === 'FRAUD_PROVIDER').length,
      banned: items.filter((r) => r.status === 'PERMANENT_BAN').length,
      pending: items.filter((r) => r.status === 'PENDING').length,
    };
  }, [riskFlags.items]);

  const handleExport = () => {
    const header = ['id', 'userId', 'ruleType', 'severity', 'status', 'context', 'triggeredAt'];
    const lines = riskFlags.items.map((row) => [
      row.id,
      row.userId,
      row.ruleType,
      row.severity,
      row.status,
      JSON.stringify(row.context ?? {}),
      row.triggeredAt,
    ].map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[header.join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `risk-users-${dayjs().format('YYYYMMDD-HHmm')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleRelease = async () => {
    if (!releaseTarget || !releaseNote.trim()) {
      message.error('请填写解封原因');
      return;
    }
    setOperating(true);
    try {
      await riskUserApi.release(releaseTarget.id, releaseNote.trim());
      message.success('已解封');
      setReleaseTarget(null);
      setReleaseNote('');
      riskFlags.reload();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? '解封失败';
      message.error(msg);
    } finally {
      setOperating(false);
    }
  };

  const handleBan = async () => {
    if (!banTarget || !banReason.trim()) {
      message.error('请填写永久拉黑原因');
      return;
    }
    setOperating(true);
    try {
      await riskUserApi.permanentBan(banTarget.id, banReason.trim());
      message.success('已永久拉黑');
      setBanTarget(null);
      setBanReason('');
      riskFlags.reload();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? '操作失败';
      message.error(msg);
    } finally {
      setOperating(false);
    }
  };

  const columns = [
    {
      title: '用户',
      key: 'user',
      render: (_: unknown, r: RiskFlag) => (
        <div>
          <div>{r.userEmail ?? r.userNickname ?? '—'}</div>
          <div
            style={{
              color: 'var(--text-muted)',
              fontSize: 11,
              fontFamily: 'var(--font-mono, monospace)',
            }}
          >
            {r.userId}
          </div>
        </div>
      ),
    },
    {
      title: '风险类型',
      key: 'ruleType',
      width: 110,
      render: (_: unknown, r: RiskFlag) => (
        <Tag variant="muted">{RULE_TYPE_LABEL[r.ruleType]}</Tag>
      ),
    },
    {
      title: '触发规则',
      key: 'ruleName',
      width: 160,
      render: (_: unknown, r: RiskFlag) =>
        r.ruleId ? (
          <Link to={`/risk-rules`}>{r.ruleName ?? r.ruleId}</Link>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        ),
    },
    {
      title: '严重度',
      key: 'severity',
      width: 100,
      render: (_: unknown, r: RiskFlag) => (
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
      title: '触发时间',
      key: 'triggeredAt',
      width: 140,
      render: (_: unknown, r: RiskFlag) => dayjs(r.triggeredAt).fromNow(),
    },
    {
      title: '当前状态',
      key: 'status',
      width: 110,
      render: (_: unknown, r: RiskFlag) => (
        <Tag variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Tag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 220,
      align: 'right' as const,
      render: (_: unknown, r: RiskFlag) => (
        <div style={{ display: 'inline-flex', gap: 4 }}>
          <Button size="small" type="link" onClick={() => setActiveRow(r)}>
            查看
          </Button>
          {canManage && (r.status === 'PENDING' || r.status === 'CONFIRMED') && (
            <Button
              size="small"
              type="link"
              onClick={() => {
                setReleaseTarget(r);
                setReleaseNote('');
              }}
            >
                解封
            </Button>
          )}
          {canManage && (r.status === 'PENDING' || r.status === 'CONFIRMED') && (
            <Button
              size="small"
              type="link"
              danger
              onClick={() => {
                setBanTarget(r);
                setBanReason('');
              }}
            >
                永久拉黑
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
                <span style={{ color: 'var(--text-muted)' }}>用户：</span>
                {activeRow.userEmail ?? activeRow.userId}
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>风险类型：</span>
                {RULE_TYPE_LABEL[activeRow.ruleType]}
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>严重度：</span>
                {SEVERITY_LABEL[activeRow.severity]}
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>状态：</span>
                {STATUS_LABEL[activeRow.status]}
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>触发时间：</span>
                {dayjs(activeRow.triggeredAt).format('YYYY-MM-DD HH:mm:ss')}
              </div>
              {activeRow.resolvedAt && (
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>处置时间：</span>
                  {dayjs(activeRow.resolvedAt).format('YYYY-MM-DD HH:mm:ss')}
                </div>
              )}
              {activeRow.resolveNote && (
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>处置备注：</span>
                  {activeRow.resolveNote}
                </div>
              )}
              {activeRow.context && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ color: 'var(--text-muted)' }}>上下文：</div>
                  <pre
                    style={{
                      background: 'var(--bg-elev, #f7f8fa)',
                      padding: 8,
                      borderRadius: 6,
                      fontSize: 12,
                      maxHeight: 220,
                      overflow: 'auto',
                    }}
                  >
                    {JSON.stringify(activeRow.context, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ),
        },
        {
          key: 'related',
          label: '关联用户',
          content: relatedLoading ? (
            <div style={{ padding: 24, textAlign: 'center' }}>加载中…</div>
          ) : related?.mode === 'TODO' ? (
            <EmptyPlaceholder
              title="未找到关联信号"
              description="该风险记录的上下文中没有可用的 IP / 设备指纹信号。"
            />
          ) : related && related.items.length === 0 ? (
            <Empty description="无关联用户" />
          ) : (
            <div style={{ fontSize: 13 }}>
              <div style={{ marginBottom: 8, color: 'var(--text-muted)' }}>
                匹配信号: {related?.items[0]?.sharedSignal ?? '—'}
              </div>
              {related?.items.map((u) => (
                <div
                  key={u.userId}
                  style={{
                    padding: '8px 12px',
                    border: '1px solid var(--border, #eee)',
                    borderRadius: 4,
                    marginBottom: 8,
                  }}
                >
                  <div style={{ fontWeight: 500 }}>
                    {u.userEmail ?? u.userNickname ?? u.userId}
                  </div>
                  <div
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: 11,
                      fontFamily: 'var(--font-mono, monospace)',
                    }}
                  >
                    {u.userId} · 关联风险 {u.flagCount} 次
                  </div>
                </div>
              ))}
            </div>
          ),
        },
        {
          key: 'history',
          label: '触发历史',
          content: timelineLoading ? (
            <div style={{ padding: 24, textAlign: 'center' }}>加载中…</div>
          ) : historyItems.length === 0 ? (
            <EmptyPlaceholder
              title="触发历史"
              description="该用户暂无其他风险触发记录。"
            />
          ) : (
            <div style={{ fontSize: 13 }}>
              {historyItems.map((item) => (
                <div
                  key={item.id}
                  style={{
                    padding: '8px 0',
                    borderBottom: '1px solid var(--border, #eee)',
                  }}
                >
                  <div>
                    {RULE_TYPE_LABEL[item.ruleType]} · {SEVERITY_LABEL[item.severity]} · {STATUS_LABEL[item.status]}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {dayjs(item.triggeredAt).format('YYYY-MM-DD HH:mm:ss')}
                  </div>
                </div>
              ))}
            </div>
          ),
        },
        {
          key: 'audit',
          label: '操作记录',
          content: timelineLoading ? (
            <div style={{ padding: 24, textAlign: 'center' }}>加载中…</div>
          ) : auditItems.length === 0 ? (
            <EmptyPlaceholder
              title="操作记录"
              description="该风险记录暂无人工处置记录。"
            />
          ) : (
            <div style={{ fontSize: 13 }}>
              {auditItems.map((item) => (
                <div
                  key={item.id}
                  style={{
                    padding: '8px 0',
                    borderBottom: '1px solid var(--border, #eee)',
                  }}
                >
                  <div>{item.action}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {dayjs(item.createdAt).format('YYYY-MM-DD HH:mm:ss')}
                    {item.operatorId ? ` · ${item.operatorId}` : ''}
                  </div>
                  {item.note && <div style={{ marginTop: 4 }}>{item.note}</div>}
                </div>
              ))}
            </div>
          ),
        },
      ]
    : [];

  return (
    <div>
      <PageHeader
        title="风险用户"
        subtitle="风控规则触发命中、人工审核与解封"
        actions={[
          <Button key="export" icon={<ExportOutlined />} onClick={handleExport}>
            导出当前页
          </Button>,
        ]}
      />

      <StatCardGroup columns={5}>
        <StatCard label="本页黑名单" value={stats.blacklistCount} />
        <StatCard label="本页异常用量" value={stats.usage} />
        <StatCard
          label="本页反欺诈"
          value={stats.fraud}
          variant={stats.fraud > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="本页已封禁"
          value={stats.banned}
          variant={stats.banned > 0 ? 'error' : 'default'}
        />
        <StatCard
          label="本页待审核"
          value={stats.pending}
          variant={stats.pending > 0 ? 'warning' : 'default'}
        />
      </StatCardGroup>

      <FilterBar
        search={{
          placeholder: '搜索用户邮箱 / ID',
          onSearch: (v) => {
            setSearch(v);
          },
        }}
        filters={[
          <Select
            key="rule"
            value={ruleType}
            style={{ width: 150 }}
            onChange={(v) => {
              setRuleType(v);
            }}
            options={RULE_TYPE_OPTIONS}
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
            value={dateRange}
            onChange={(range) => {
              setDateRange(range);
            }}
          />,
        ]}
      />

      <DataTable<RiskFlag>
        columns={columns}
        dataSource={riskFlags.items}
        rowKey="id"
        loading={riskFlags.loading}
        listPagination={riskFlags.tablePagination}
        scroll={{ x: 1200 }}
      />

      <DetailDrawer
        open={!!activeRow}
        onClose={() => setActiveRow(null)}
        title={activeRow?.userEmail ?? activeRow?.userId ?? '风险记录'}
        subtitle={
          activeRow
            ? `${RULE_TYPE_LABEL[activeRow.ruleType]} · ${SEVERITY_LABEL[activeRow.severity]}`
            : undefined
        }
        status={
          activeRow ? (
            <Tag variant={STATUS_VARIANT[activeRow.status]}>
              {STATUS_LABEL[activeRow.status]}
            </Tag>
          ) : null
        }
        tabs={drawerTabs}
      />

      <Modal
        title="解封风险记录"
        open={!!releaseTarget}
        onOk={handleRelease}
        confirmLoading={operating}
        onCancel={() => setReleaseTarget(null)}
        okText="确认解封"
      >
        <Input.TextArea
          rows={3}
          value={releaseNote}
          onChange={(e) => setReleaseNote(e.target.value)}
          placeholder="请输入解封原因，便于后续审计"
        />
      </Modal>

      <Modal
        title="永久拉黑用户"
        open={!!banTarget}
        onOk={handleBan}
        confirmLoading={operating}
        onCancel={() => setBanTarget(null)}
        okText="确认拉黑"
        okButtonProps={{ danger: true }}
      >
        <Input.TextArea
          rows={3}
          value={banReason}
          onChange={(e) => setBanReason(e.target.value)}
          placeholder="请输入永久拉黑原因"
        />
      </Modal>
    </div>
  );
}
