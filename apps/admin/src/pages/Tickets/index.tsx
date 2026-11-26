import { useCallback, useMemo, useState } from 'react';
import { App, Button, Select, DatePicker, Modal, Form, Input } from 'antd';
import { PlusOutlined, ExportOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import {
  PageHeader,
  StatCard,
  StatCardGroup,
  FilterBar,
  DataTable,
  Tag,
  type TagVariant,
} from '../../components/common';
import { ticketApi, type Ticket } from '../../api/v2';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { usePermission } from '../../hooks/usePermission';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { RangePicker } = DatePicker;

const CATEGORY_OPTIONS = [
  { value: 'all', label: '全部分类' },
  { value: 'BILLING', label: '计费' },
  { value: 'TECHNICAL', label: '技术' },
  { value: 'REFUND', label: '退款' },
  { value: 'FEATURE', label: '功能建议' },
  { value: 'OTHER', label: '其他' },
];

const PRIORITY_OPTIONS = [
  { value: 'all', label: '全部优先级' },
  { value: 'URGENT', label: '紧急' },
  { value: 'HIGH', label: '高' },
  { value: 'NORMAL', label: '普通' },
  { value: 'LOW', label: '低' },
];

const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'OPEN', label: '未处理' },
  { value: 'IN_PROGRESS', label: '处理中' },
  { value: 'RESOLVED', label: '已解决' },
  { value: 'CLOSED', label: '已关闭' },
];

const CATEGORY_VARIANT: Record<Ticket['category'], TagVariant> = {
  BILLING: 'proc',
  TECHNICAL: 'muted',
  REFUND: 'warn',
  FEATURE: 'success',
  OTHER: 'muted',
};
const CATEGORY_LABEL: Record<Ticket['category'], string> = {
  BILLING: '计费',
  TECHNICAL: '技术',
  REFUND: '退款',
  FEATURE: '功能',
  OTHER: '其他',
};

const PRIORITY_VARIANT: Record<Ticket['priority'], TagVariant> = {
  URGENT: 'error',
  HIGH: 'warn',
  NORMAL: 'muted',
  LOW: 'muted',
};
const PRIORITY_LABEL: Record<Ticket['priority'], string> = {
  URGENT: '紧急',
  HIGH: '高',
  NORMAL: '普通',
  LOW: '低',
};

const STATUS_VARIANT: Record<Ticket['status'], TagVariant> = {
  OPEN: 'warn',
  IN_PROGRESS: 'proc',
  RESOLVED: 'success',
  CLOSED: 'muted',
};
const STATUS_LABEL: Record<Ticket['status'], string> = {
  OPEN: '未处理',
  IN_PROGRESS: '处理中',
  RESOLVED: '已解决',
  CLOSED: '已关闭',
};

interface TicketRow extends Ticket {
  userEmail?: string;
  assigneeName?: string;
  lastReplyAt?: string;
}

export default function TicketsPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [priority, setPriority] = useState('all');
  const [status, setStatus] = useState('all');
  const [assignee, setAssignee] = useState('');
  const [dateRange, setDateRange] = useState<
    [dayjs.Dayjs | null, dayjs.Dayjs | null] | null
  >(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm] = Form.useForm();
  const canManage = usePermission('admin.page.tickets.manage');

  const fetchTickets = useCallback(
    async ({ page, pageSize }: { page: number; pageSize: number }) => {
      const res = await ticketApi.list({
        page,
        pageSize,
        search: search || undefined,
        category: category === 'all' ? undefined : category,
        priority: priority === 'all' ? undefined : priority,
        status: status === 'all' ? undefined : status,
        assigneeId: assignee || undefined,
        createdFrom: dateRange?.[0]?.format('YYYY-MM-DD'),
        createdTo: dateRange?.[1]?.format('YYYY-MM-DD'),
      });
      return res as { items: TicketRow[]; total: number };
    },
    [assignee, category, dateRange, priority, search, status],
  );

  const tickets = usePaginatedList<TicketRow>({
    fetcher: fetchTickets,
    deps: [search, category, priority, status, assignee, dateRange],
    clearOnError: true,
    onError: () => message.error('加载工单列表失败'),
  });

  const stats = useMemo(() => {
    const items = tickets.items;
    const open = items.filter((t) => t.status === 'OPEN').length;
    const inProgress = items.filter((t) => t.status === 'IN_PROGRESS').length;
    const slaRisk = items.filter((t) => {
      if (t.status === 'RESOLVED' || t.status === 'CLOSED') return false;
      return dayjs().diff(dayjs(t.createdAt), 'hour') >= 24;
    }).length;
    const today = items.filter(
      (t) => dayjs(t.createdAt).isAfter(dayjs().startOf('day')),
    ).length;
    return { open, inProgress, slaRisk, today };
  }, [tickets.items]);

  const handleExport = () => {
    const header = ['ticketNumber', 'subject', 'userId', 'category', 'priority', 'status', 'assigneeId', 'createdAt'];
    const lines = tickets.items.map((row) => [
      row.ticketNumber,
      row.subject,
      row.userId,
      row.category,
      row.priority,
      row.status,
      row.assigneeId ?? '',
      row.createdAt,
    ].map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[header.join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tickets-page-${dayjs().format('YYYYMMDD-HHmm')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCreate = async () => {
    const values = await createForm.validateFields();
    setCreating(true);
    try {
      const created = await ticketApi.create({
        userId: values.userId.trim(),
        subject: values.subject.trim(),
        category: values.category,
        priority: values.priority,
        content: values.content?.trim() || undefined,
      });
      message.success('工单已创建');
      setCreateOpen(false);
      createForm.resetFields();
      navigate(`/tickets/${created.id}`);
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? '创建工单失败';
      message.error(msg);
    } finally {
      setCreating(false);
    }
  };

  const columns = [
    {
      title: '工单号',
      dataIndex: 'ticketNumber',
      key: 'ticketNumber',
      width: 170,
      render: (v: string) => (
        <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{v}</span>
      ),
    },
    {
      title: '标题',
      key: 'subject',
      render: (_: unknown, r: TicketRow) => (
        <div>
          <div>{r.subject}</div>
          {r.userEmail && (
            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
              {r.userEmail}
            </div>
          )}
        </div>
      ),
    },
    {
      title: '分类',
      key: 'category',
      width: 80,
      render: (_: unknown, r: TicketRow) => (
        <Tag variant={CATEGORY_VARIANT[r.category]}>
          {CATEGORY_LABEL[r.category]}
        </Tag>
      ),
    },
    {
      title: '优先级',
      key: 'priority',
      width: 90,
      render: (_: unknown, r: TicketRow) => (
        <Tag variant={PRIORITY_VARIANT[r.priority]}>
          {PRIORITY_LABEL[r.priority]}
        </Tag>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 100,
      render: (_: unknown, r: TicketRow) => (
        <Tag variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Tag>
      ),
    },
    {
      title: '处理人',
      key: 'assignee',
      width: 110,
      render: (_: unknown, r: TicketRow) =>
        r.assigneeName ?? r.assigneeId ?? (
          <span style={{ color: 'var(--text-muted)' }}>未分配</span>
        ),
    },
    {
      title: '创建时间',
      key: 'createdAt',
      width: 120,
      render: (_: unknown, r: TicketRow) => dayjs(r.createdAt).fromNow(),
    },
    {
      title: '最近回复',
      key: 'lastReplyAt',
      width: 120,
      render: (_: unknown, r: TicketRow) =>
        r.lastReplyAt ? (
          dayjs(r.lastReplyAt).fromNow()
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        ),
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      align: 'right' as const,
      render: (_: unknown, r: TicketRow) => (
        <Button
          size="small"
          type="link"
          onClick={() => navigate(`/tickets/${r.id}`)}
        >
          {canManage ? '处理' : '查看'}
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="工单中心"
        subtitle="客服工单 + 用户反馈，支持分类 / 优先级 / SLA 管理"
        actions={[
          <Button key="export" icon={<ExportOutlined />} onClick={handleExport}>
            导出当前页
          </Button>,
          ...(canManage ? [
            <Button
              key="new"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                createForm.resetFields();
                setCreateOpen(true);
              }}
            >
              新建工单
            </Button>,
          ] : []),
        ]}
      />

      <StatCardGroup columns={5}>
        <StatCard label="本页未处理" value={stats.open} variant="warning" />
        <StatCard label="本页处理中" value={stats.inProgress} />
        <StatCard
          label="24h SLA 风险"
          value={stats.slaRisk}
          variant={stats.slaRisk > 0 ? 'error' : 'default'}
        />
          <StatCard label="本页今日新增" value={stats.today} />
        <StatCard label="平均响应" value="—" />
      </StatCardGroup>

      <FilterBar
        search={{
          placeholder: '搜索标题 / 邮箱 / 工单号',
          onSearch: setSearch,
        }}
        filters={[
          <Select
            key="category"
            value={category}
            style={{ width: 130 }}
            onChange={setCategory}
            options={CATEGORY_OPTIONS}
          />,
          <Select
            key="priority"
            value={priority}
            style={{ width: 130 }}
            onChange={setPriority}
            options={PRIORITY_OPTIONS}
          />,
          <Select
            key="status"
            value={status}
            style={{ width: 130 }}
            onChange={setStatus}
            options={STATUS_OPTIONS}
          />,
          <Input
            key="assignee"
            value={assignee}
            style={{ width: 160 }}
            placeholder="处理人 ID"
            allowClear
            onChange={(e) => setAssignee(e.target.value.trim())}
          />,
          <Button
            key="unassigned"
            onClick={() => setAssignee('unassigned')}
          >
            未分配
          </Button>,
          <RangePicker
            key="range"
            value={dateRange}
            onChange={setDateRange}
          />,
        ]}
      />

      <DataTable<TicketRow>
        columns={columns}
        dataSource={tickets.items}
        rowKey="id"
        loading={tickets.loading}
        listPagination={tickets.tablePagination}
        scroll={{ x: 1200 }}
      />

      <Modal
        title="新建工单"
        open={createOpen}
        onOk={handleCreate}
        confirmLoading={creating}
        onCancel={() => setCreateOpen(false)}
        okText="创建"
        width={560}
      >
        <Form
          form={createForm}
          layout="vertical"
          initialValues={{ category: 'OTHER', priority: 'NORMAL' }}
        >
          <Form.Item name="userId" label="用户 ID" rules={[{ required: true }]}>
            <Input placeholder="输入用户 ID" />
          </Form.Item>
          <Form.Item name="subject" label="标题" rules={[{ required: true }]}>
            <Input placeholder="简要描述问题" />
          </Form.Item>
          <Form.Item name="category" label="分类" rules={[{ required: true }]}>
            <Select options={CATEGORY_OPTIONS.filter((o) => o.value !== 'all')} />
          </Form.Item>
          <Form.Item name="priority" label="优先级" rules={[{ required: true }]}>
            <Select options={PRIORITY_OPTIONS.filter((o) => o.value !== 'all')} />
          </Form.Item>
          <Form.Item name="content" label="初始说明">
            <Input.TextArea rows={4} placeholder="可选，作为客服内部代提单的首条消息" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
