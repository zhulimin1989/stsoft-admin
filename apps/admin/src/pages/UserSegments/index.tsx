import { useCallback, useMemo, useState } from 'react';
import { App, Button, Modal, Form, Input, Select } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  PageHeader,
  StatCard,
  StatCardGroup,
  FilterBar,
  DataTable,
  Tag,
} from '../../components/common';
import { userSegmentApi, type UserSegment } from '../../api/v2';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { usePermission } from '../../hooks/usePermission';

const RULE_TYPE_OPTIONS = [
  { value: 'all', label: '全部类型' },
  { value: 'STATIC', label: '静态' },
  { value: 'DYNAMIC', label: '动态' },
];

function ruleTypeTag(t: UserSegment['ruleType']) {
  return t === 'STATIC' ? (
    <Tag variant="muted">静态</Tag>
  ) : (
    <Tag variant="proc">动态</Tag>
  );
}

function statusTag(active: boolean) {
  return active ? (
    <Tag variant="success">启用</Tag>
  ) : (
    <Tag variant="muted">停用</Tag>
  );
}

export default function UserSegmentsPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [ruleType, setRuleType] = useState<string>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const canManage = usePermission('admin.page.user_segments.manage');
  const createRuleType = Form.useWatch('ruleType', form);

  const fetchSegments = useCallback(
    ({ page, pageSize }: { page: number; pageSize: number }) =>
      userSegmentApi.list({
        page,
        pageSize,
        search: search || undefined,
        ruleType: ruleType === 'all' ? undefined : ruleType,
      }),
    [ruleType, search],
  );

  const segments = usePaginatedList<UserSegment>({
    fetcher: fetchSegments,
    deps: [search, ruleType],
    onError: () => message.error('加载分群列表失败'),
  });

  const stats = useMemo(() => {
    const items = segments.items;
    const staticCount = items.filter((s) => s.ruleType === 'STATIC').length;
    const dynamicCount = items.filter((s) => s.ruleType === 'DYNAMIC').length;
    const totalMembers = items.reduce((acc, s) => acc + (s.memberCount ?? 0), 0);
    return { staticCount, dynamicCount, totalMembers };
  }, [segments.items]);

  const handleCreate = async () => {
    const values = await form.validateFields();
    try {
      await userSegmentApi.create(values);
      message.success('已创建');
      setModalOpen(false);
      form.resetFields();
      segments.reload();
    } catch {
      message.error('创建失败');
    }
  };

  const columns = [
    {
      title: '分群',
      key: 'name',
      render: (_: unknown, r: UserSegment) => (
        <div>
          <div>{r.name}</div>
          {r.description && (
            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
              {r.description}
            </div>
          )}
        </div>
      ),
    },
    {
      title: '类型',
      key: 'ruleType',
      width: 90,
      render: (_: unknown, r: UserSegment) => ruleTypeTag(r.ruleType),
    },
    {
      title: '成员数',
      dataIndex: 'memberCount',
      key: 'memberCount',
      width: 110,
      render: (v: number) => (v ?? 0).toLocaleString('zh-CN'),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 180,
    },
    {
      title: '状态',
      key: 'isActive',
      width: 90,
      render: (_: unknown, r: UserSegment) => statusTag(r.isActive),
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      align: 'right' as const,
      render: (_: unknown, r: UserSegment) => (
        <Button
          size="small"
          type="link"
          onClick={() => navigate(`/user-segments/${r.id}`)}
        >
          详情
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="用户分群"
        subtitle="按规则圈定用户群体，用于精细化运营"
        actions={
          canManage ? [
            <Button
              key="new"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                form.resetFields();
                setModalOpen(true);
              }}
            >
              新建分群
            </Button>,
          ] : []
        }
      />

      <StatCardGroup>
        <StatCard label="分群总数" value={segments.total} />
        <StatCard label="静态分群" value={stats.staticCount} />
        <StatCard
          label="动态分群"
          value={stats.dynamicCount}
          variant="success"
        />
        <StatCard label="总用户覆盖" value={stats.totalMembers} />
      </StatCardGroup>

      <FilterBar
        search={{
          placeholder: '搜索分群名 / 描述',
          onSearch: setSearch,
        }}
        filters={[
          <Select
            key="ruleType"
            value={ruleType}
            style={{ width: 140 }}
            onChange={setRuleType}
            options={RULE_TYPE_OPTIONS}
          />,
        ]}
      />

      <DataTable<UserSegment>
        columns={columns}
        dataSource={segments.items}
        rowKey="id"
        loading={segments.loading}
        listPagination={segments.tablePagination}
      />

      <Modal
        title="新建分群"
        open={modalOpen}
        onOk={handleCreate}
        onCancel={() => setModalOpen(false)}
        width={520}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="分群名" rules={[{ required: true }]}>
            <Input placeholder="如：高活跃付费用户" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="可选" />
          </Form.Item>
          <Form.Item
            name="ruleType"
            label="规则类型"
            initialValue="STATIC"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: 'STATIC', label: '静态（手动维护成员）' },
                { value: 'DYNAMIC', label: '动态（按规则匹配）' },
              ]}
            />
          </Form.Item>
          {createRuleType === 'DYNAMIC' && (
            <Form.Item
              name="ruleExpr"
              label="动态规则 JSON"
              rules={[{ required: true, message: '动态分群必须填写规则' }]}
            >
              <Input.TextArea
                rows={6}
                placeholder='{"and": [{"field": "monthlySpentCents", "op": ">", "value": 10000}]}'
                style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
