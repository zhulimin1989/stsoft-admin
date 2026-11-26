import { useState, useCallback, useMemo } from 'react';
import { Button, Select, DatePicker, message } from 'antd';
import { ExportOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  PageHeader,
  StatCard,
  StatCardGroup,
  FilterBar,
  DataTable,
  Tag,
  DetailDrawer,
  type TagVariant,
} from '../../components/common';
import { auditLogApi } from '../../api/admin';
import { usePaginatedList } from '../../hooks/usePaginatedList';

const { RangePicker } = DatePicker;

interface AuditLog {
  id: string;
  adminUserId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  detail: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

const ACTION_VARIANTS: Record<string, TagVariant> = {
  create: 'success',
  update: 'proc',
  delete: 'error',
  login: 'proc',
  grant_credits: 'warn',
  deduct_credits: 'warn',
  change_tier: 'proc',
  change_password: 'muted',
  toggle_status: 'muted',
};

const ACTION_OPTIONS = [
  { value: 'all', label: '全部操作' },
  { value: 'login', label: '登录' },
  { value: 'create', label: '创建' },
  { value: 'update', label: '更新' },
  { value: 'delete', label: '删除' },
  { value: 'grant_credits', label: '充值积分' },
  { value: 'deduct_credits', label: '扣减积分' },
  { value: 'change_tier', label: '变更套餐' },
];

const RESOURCE_OPTIONS = [
  { value: 'all', label: '全部主体' },
  { value: 'user', label: '用户' },
  { value: 'admin', label: '管理员' },
  { value: 'channel', label: '渠道' },
  { value: 'tier', label: '套餐' },
  { value: 'order', label: '订单' },
  { value: 'plan', label: '套餐' },
];

export default function AuditLogsPage() {
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [resourceFilter, setResourceFilter] = useState('all');
  const [dateRange, setDateRange] = useState<
    [dayjs.Dayjs | null, dayjs.Dayjs | null] | null
  >(null);
  const [activeRow, setActiveRow] = useState<AuditLog | null>(null);

  const auditLogs = usePaginatedList<AuditLog>({
    pageSize: 50,
    deps: [search, actionFilter, resourceFilter],
    onError: () => message.error('加载审计日志失败'),
    fetcher: useCallback(async ({ page, pageSize }) => {
      const params: {
        page: number;
        pageSize: number;
        action?: string;
        resource?: string;
        search?: string;
      } = { page, pageSize };
      if (actionFilter !== 'all') params.action = actionFilter;
      if (resourceFilter !== 'all') params.resource = resourceFilter;
      if (search.trim()) params.search = search.trim();
      const res = await auditLogApi.list(params);
      return {
        items: res.items || [],
        total: res.total || 0,
        page,
        pageSize,
      };
    }, [actionFilter, resourceFilter, search]),
  });

  const stats = useMemo(() => {
    const now = dayjs();
    const last24h = auditLogs.items.filter(
      (l) => now.diff(dayjs(l.createdAt), 'hour') < 24,
    ).length;
    const adminSet = new Set(auditLogs.items.map((l) => l.adminUserId).filter(Boolean));
    const targetSet = new Set(
      auditLogs.items
        .filter((l) => l.resourceType === 'user')
        .map((l) => l.resourceId)
        .filter(Boolean),
    );
    return {
      total: auditLogs.total,
      last24h,
      adminCount: adminSet.size,
      affectedUsers: targetSet.size,
    };
  }, [auditLogs.items, auditLogs.total]);

  const visibleLogs = useMemo(() => {
    return auditLogs.items.filter((log) => {
      if (dateRange?.[0] && dayjs(log.createdAt).isBefore(dateRange[0].startOf('day'))) {
        return false;
      }
      if (dateRange?.[1] && dayjs(log.createdAt).isAfter(dateRange[1].endOf('day'))) {
        return false;
      }
      return true;
    });
  }, [auditLogs.items, dateRange]);

  const handleExport = () => {
    const header = ['createdAt', 'adminUserId', 'action', 'resourceType', 'resourceId', 'ipAddress', 'detail'];
    const lines = visibleLogs.map((log) => [
      log.createdAt,
      log.adminUserId,
      log.action,
      log.resourceType,
      log.resourceId ?? '',
      log.ipAddress ?? '',
      log.detail ? JSON.stringify(log.detail) : '',
    ].map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[header.join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-logs-${dayjs().format('YYYYMMDD-HHmm')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const columns = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (v: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-'),
    },
    {
      title: '操作员',
      dataIndex: 'adminUserId',
      key: 'adminUserId',
      width: 200,
      ellipsis: true,
    },
    {
      title: '操作类型',
      dataIndex: 'action',
      key: 'action',
      width: 120,
      render: (action: string) => (
        <Tag variant={ACTION_VARIANTS[action] ?? 'muted'}>{action}</Tag>
      ),
    },
    {
      title: '主体',
      dataIndex: 'resourceType',
      key: 'resourceType',
      width: 100,
      render: (v: string) => <Tag variant="muted">{v}</Tag>,
    },
    {
      title: '主体 ID',
      dataIndex: 'resourceId',
      key: 'resourceId',
      ellipsis: true,
      render: (v: string | null) => v || '-',
    },
    {
      title: 'IP',
      dataIndex: 'ipAddress',
      key: 'ipAddress',
      width: 130,
      render: (v: string | null) => v || '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      align: 'right' as const,
      render: (_: unknown, r: AuditLog) => (
        <Button size="small" type="link" onClick={() => setActiveRow(r)}>
          详情
        </Button>
      ),
    },
  ];

  const drawerTabs = activeRow
    ? [
        {
          key: 'info',
          label: '基本信息',
          content: (
            <div style={{ fontSize: 13, lineHeight: 2 }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>时间：</span>
                {dayjs(activeRow.createdAt).format('YYYY-MM-DD HH:mm:ss')}
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>操作员：</span>
                {activeRow.adminUserId}
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>操作类型：</span>
                {activeRow.action}
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>主体：</span>
                {activeRow.resourceType} / {activeRow.resourceId ?? '—'}
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>IP：</span>
                {activeRow.ipAddress ?? '—'}
              </div>
            </div>
          ),
        },
        {
          key: 'detail',
          label: '完整 Diff',
          content: activeRow.detail ? (
            <pre
              style={{
                background: 'var(--bg-elev, #f7f8fa)',
                padding: 12,
                borderRadius: 6,
                fontSize: 12,
                maxHeight: 480,
                overflow: 'auto',
              }}
            >
              {JSON.stringify(activeRow.detail, null, 2)}
            </pre>
          ) : (
            <div style={{ color: 'var(--text-muted)' }}>无 detail 数据</div>
          ),
        },
      ]
    : [];

  return (
    <div>
      <PageHeader
        title="审计日志"
        subtitle="所有管理员操作记录"
        actions={[
          <Button
            key="export"
            icon={<ExportOutlined />}
            onClick={handleExport}
          >
            导出
          </Button>,
        ]}
      />

      <StatCardGroup columns={4}>
        <StatCard label="总条数" value={stats.total} />
        <StatCard label="24h 内" value={stats.last24h} />
        <StatCard label="操作员数" value={stats.adminCount} />
        <StatCard label="受影响用户" value={stats.affectedUsers} />
      </StatCardGroup>

      <FilterBar
        search={{
          placeholder: '搜索操作员 / 主体 ID',
          onSearch: (v) => {
            setSearch(v.trim());
          },
        }}
        filters={[
          <Select
            key="action"
            value={actionFilter}
            style={{ width: 130 }}
            onChange={(v) => {
              setActionFilter(v);
            }}
            options={ACTION_OPTIONS}
          />,
          <Select
            key="resource"
            value={resourceFilter}
            style={{ width: 130 }}
            onChange={(v) => {
              setResourceFilter(v);
            }}
            options={RESOURCE_OPTIONS}
          />,
          <RangePicker
            key="range"
            value={dateRange ?? undefined}
            onChange={(range) => setDateRange(range as [dayjs.Dayjs | null, dayjs.Dayjs | null] | null)}
          />,
        ]}
      />

      <DataTable<AuditLog>
        columns={columns}
        dataSource={visibleLogs}
        rowKey="id"
        loading={auditLogs.loading}
        listPagination={auditLogs.tablePagination}
        scroll={{ x: 1100 }}
      />

      <DetailDrawer
        open={!!activeRow}
        onClose={() => setActiveRow(null)}
        title={activeRow ? `${activeRow.action} · ${activeRow.resourceType}` : '审计详情'}
        subtitle={
          activeRow ? `${activeRow.adminUserId} · ${activeRow.ipAddress ?? '—'}` : undefined
        }
        tabs={drawerTabs}
      />
    </div>
  );
}
