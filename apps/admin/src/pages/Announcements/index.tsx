import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Button,
  Modal,
  Form,
  Input,
  Select,
  Switch,
  DatePicker,
  Popconfirm,
  message,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  PageHeader,
  StatCard,
  StatCardGroup,
  FilterBar,
  DataTable,
  Tag,
  type TagVariant,
} from '../../components/common';
import { announcementApi } from '../../api/admin';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { usePermission } from '../../hooks/usePermission';

const { RangePicker } = DatePicker;

interface Announcement {
  id: string;
  title: string;
  content: string;
  type: string;
  targetAudience: string;
  isActive: boolean;
  startAt?: string | null;
  endAt?: string | null;
  readCount?: number;
  segmentId?: string | null;
  createdAt: string;
}

const TYPE_OPTIONS = [
  { label: '通知', value: 'info' },
  { label: '警告', value: 'warning' },
  { label: '维护', value: 'maintenance' },
  { label: '更新', value: 'update' },
];

const TYPE_FILTER_OPTIONS = [
  { value: 'all', label: '全部类型' },
  ...TYPE_OPTIONS.map((t) => ({ value: t.value, label: t.label })),
];

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'active', label: '生效中' },
  { value: 'inactive', label: '已停用' },
  { value: 'expired', label: '已过期' },
];

const TYPE_VARIANTS: Record<string, TagVariant> = {
  info: 'proc',
  warning: 'warn',
  maintenance: 'error',
  update: 'success',
};

const TYPE_LABELS: Record<string, string> = {
  info: '通知',
  warning: '警告',
  maintenance: '维护',
  update: '更新',
};

const AUDIENCE_OPTIONS = [
  { label: '所有用户', value: 'all' },
  { label: '免费用户', value: 'free' },
  { label: 'Pro 用户', value: 'pro' },
  { label: 'Max 用户', value: 'max' },
];

interface FormValues {
  title: string;
  content: string;
  type: string;
  targetAudience: string;
  range?: [dayjs.Dayjs, dayjs.Dayjs];
  segmentId?: string;
}

export default function AnnouncementsPage() {
  const canManage = usePermission('admin.page.announcements.manage');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<Announcement | null>(null);
  const allAnnouncementsRef = useRef<Announcement[] | null>(null);
  const [form] = Form.useForm<FormValues>();

  const announcements = usePaginatedList<Announcement>({
    pageSize: 20,
    onError: () => message.error('加载公告列表失败'),
    fetcher: useCallback(async ({ page, pageSize }) => {
      const all = allAnnouncementsRef.current ?? await announcementApi.listAll<Announcement>();
      allAnnouncementsRef.current = all;
      const now = dayjs();
      const filtered = all.filter((d) => {
        const query = search.trim().toLowerCase();
        if (query && !d.title.toLowerCase().includes(query) && !d.content.toLowerCase().includes(query)) return false;
        if (typeFilter !== 'all' && d.type !== typeFilter) return false;
        if (statusFilter === 'active') {
          const isExpired = d.endAt && now.isAfter(dayjs(d.endAt));
          if (!d.isActive || isExpired) return false;
        }
        if (statusFilter === 'inactive' && d.isActive) return false;
        if (statusFilter === 'expired' && !(d.endAt && now.isAfter(dayjs(d.endAt)))) return false;
        return true;
      });
      return {
        items: filtered.slice((page - 1) * pageSize, page * pageSize),
        total: filtered.length,
        page,
        pageSize,
      };
    }, [search, statusFilter, typeFilter]),
    deps: [search, statusFilter, typeFilter],
  });
  const reloadAnnouncements = () => {
    allAnnouncementsRef.current = null;
    announcements.reload();
  };

  const stats = useMemo(() => {
    const now = dayjs();
    const active = announcements.items.filter((d) => {
      if (!d.isActive) return false;
      if (d.endAt && now.isAfter(dayjs(d.endAt))) return false;
      return true;
    }).length;
    const expired = announcements.items.filter(
      (d) => d.endAt && now.isAfter(dayjs(d.endAt)),
    ).length;
    const reads = announcements.items.reduce((acc, d) => acc + (d.readCount ?? 0), 0);
    const totalAudience = announcements.items.length * 1; // unknown — placeholder
    const readRate = totalAudience > 0 && reads > 0 ? `${((reads / (totalAudience * 100)) * 100).toFixed(1)}%` : '—';
    return { active, expired, reads, readRate };
  }, [announcements.items]);

  const handleToggleActive = async (id: string, isActive: boolean) => {
    try {
      await announcementApi.toggle(id);
      message.success(isActive ? '已启用' : '已禁用');
      reloadAnnouncements();
    } catch {
      message.error('操作失败');
    }
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    const payload: Record<string, unknown> = {
      title: values.title,
      content: values.content,
      type: values.type,
      targetAudience: values.targetAudience,
    };
    if (values.range && values.range.length === 2) {
      payload.startAt = values.range[0].toISOString();
      payload.endAt = values.range[1].toISOString();
    }
    if (values.segmentId) payload.segmentId = values.segmentId;
    try {
      if (editRecord) {
        await announcementApi.update(
          editRecord.id,
          payload as Parameters<typeof announcementApi.update>[1],
        );
        message.success('公告已更新');
      } else {
        await announcementApi.create(
          payload as Parameters<typeof announcementApi.create>[0],
        );
        message.success('公告创建成功');
      }
      setModalOpen(false);
      setEditRecord(null);
      form.resetFields();
      reloadAnnouncements();
    } catch {
      message.error(editRecord ? '更新失败' : '创建失败');
    }
  };

  const handleEdit = (record: Announcement) => {
    setEditRecord(record);
    form.setFieldsValue({
      title: record.title,
      content: record.content,
      type: record.type,
      targetAudience: record.targetAudience,
      range:
        record.startAt && record.endAt
          ? [dayjs(record.startAt), dayjs(record.endAt)]
          : undefined,
      segmentId: record.segmentId ?? undefined,
    });
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await announcementApi.delete(id);
      message.success('公告已删除');
      reloadAnnouncements();
    } catch {
      message.error('删除失败');
    }
  };

  const filteredData = announcements.items;

  const columns = [
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (type: string) => (
        <Tag variant={TYPE_VARIANTS[type] ?? 'muted'}>
          {TYPE_LABELS[type] ?? type}
        </Tag>
      ),
    },
    {
      title: '受众',
      dataIndex: 'targetAudience',
      key: 'targetAudience',
      width: 110,
      render: (v: string) =>
        AUDIENCE_OPTIONS.find((a) => a.value === v)?.label ?? v,
    },
    {
      title: '生效区间',
      key: 'range',
      width: 200,
      render: (_: unknown, r: Announcement) => {
        if (!r.startAt && !r.endAt) return <span style={{ color: 'var(--text-muted)' }}>永久</span>;
        const fmt = (d?: string | null) => (d ? dayjs(d).format('MM-DD HH:mm') : '—');
        return `${fmt(r.startAt)} ~ ${fmt(r.endAt)}`;
      },
    },
    {
      title: '阅读数',
      key: 'reads',
      width: 90,
      render: (_: unknown, r: Announcement) => r.readCount ?? '—',
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 90,
      render: (active: boolean, record: Announcement) => (
        <Switch
          checked={active}
          onChange={(checked) => handleToggleActive(record.id, checked)}
          checkedChildren="启用"
          unCheckedChildren="禁用"
          disabled={!canManage}
          size="small"
        />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 130,
      align: 'right' as const,
      render: (_: unknown, record: Announcement) => (
        <div style={{ display: 'inline-flex', gap: 4 }}>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
            disabled={!canManage}
          >
            编辑
          </Button>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(record.id)}>
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={!canManage}
            >
              删除
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="公告"
        subtitle="发布全员或分群公告,跟踪阅读情况"
        actions={[
          <Button
            key="new"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditRecord(null);
              form.resetFields();
              setModalOpen(true);
            }}
            disabled={!canManage}
          >
            发布公告
          </Button>,
        ]}
      />

      <StatCardGroup columns={4}>
        <StatCard
          label="当前生效"
          value={stats.active}
          variant={stats.active > 0 ? 'success' : 'default'}
        />
        <StatCard label="已过期" value={stats.expired} />
        <StatCard label="30 天点击" value={stats.reads} />
        <StatCard label="阅读率" value={stats.readRate} />
      </StatCardGroup>

      <FilterBar
        search={{
          placeholder: '搜索标题 / 内容',
          onSearch: (v) => setSearch(v),
        }}
        filters={[
          <Select
            key="type"
            value={typeFilter}
            style={{ width: 130 }}
            onChange={setTypeFilter}
            options={TYPE_FILTER_OPTIONS}
          />,
          <Select
            key="status"
            value={statusFilter}
            style={{ width: 130 }}
            onChange={setStatusFilter}
            options={STATUS_FILTER_OPTIONS}
          />,
          <RangePicker key="range" />,
        ]}
      />

      <DataTable<Announcement>
        columns={columns}
        dataSource={filteredData}
        rowKey="id"
        loading={announcements.loading}
        listPagination={announcements.tablePagination}
        scroll={{ x: 1000 }}
      />

      <Modal
        title={editRecord ? '编辑公告' : '发布公告'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => {
          setModalOpen(false);
          setEditRecord(null);
        }}
        okText={editRecord ? '保存' : '发布'}
        cancelText="取消"
        width={640}
        destroyOnClose
        okButtonProps={{ disabled: !canManage }}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }} disabled={!canManage}>
          <Form.Item
            name="title"
            label="标题"
            rules={[{ required: true, message: '请输入公告标题' }]}
          >
            <Input placeholder="公告标题" />
          </Form.Item>
          <Form.Item
            name="content"
            label="内容 (支持 Markdown)"
            rules={[{ required: true, message: '请输入公告内容' }]}
          >
            <Input.TextArea rows={6} placeholder="公告内容,支持 Markdown" />
          </Form.Item>
          <Form.Item
            name="type"
            label="类型"
            rules={[{ required: true, message: '请选择类型' }]}
          >
            <Select options={TYPE_OPTIONS} placeholder="选择类型" />
          </Form.Item>
          <Form.Item
            name="targetAudience"
            label="受众"
            rules={[{ required: true, message: '请选择受众' }]}
          >
            <Select options={AUDIENCE_OPTIONS} placeholder="选择受众" />
          </Form.Item>
          <Form.Item name="segmentId" label="精准分群 ID(可选)">
            <Input placeholder="user-segment id" />
          </Form.Item>
          <Form.Item name="range" label="生效区间(可选)">
            <RangePicker style={{ width: '100%' }} showTime />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
