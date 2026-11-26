import { useState, useEffect, useCallback } from 'react';
import {
  Switch,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Typography,
  message,
} from 'antd';
import { PlusOutlined, EditOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  PageHeader,
  DataTable,
  Tag,
  type TagVariant,
} from '../../components/common';
import { featureFlagApi } from '../../api/admin';
import { usePermission } from '../../hooks/usePermission';

interface FeatureFlag {
  id: string;
  key: string;
  description: string;
  value: boolean;
  scope: string;
  scopeValue?: string | null;
  updatedAt: string;
}

const SCOPE_OPTIONS = [
  { label: '全局', value: 'global' },
  { label: '套餐', value: 'tier' },
  { label: '用户', value: 'user' },
];

const SCOPE_VARIANTS: Record<string, TagVariant> = {
  global: 'proc',
  tier: 'success',
  user: 'warn',
};

const TYPE_VARIANTS: Record<string, TagVariant> = {
  boolean: 'proc',
  percent: 'warn',
  segment: 'success',
};

function inferType(flag: FeatureFlag): 'boolean' | 'percent' | 'segment' {
  if (flag.scope === 'global') return 'boolean';
  if (flag.scope === 'tier') return 'segment';
  if (flag.scope === 'user') return 'segment';
  return 'boolean';
}

export default function FeatureFlagsPage() {
  const canManage = usePermission('admin.page.feature_flags.manage');
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FeatureFlag | null>(null);
  const [form] = Form.useForm();

  const fetchFlags = useCallback(async () => {
    setLoading(true);
    try {
      const res = await featureFlagApi.list();
      setFlags(res?.items || res || []);
    } catch {
      message.error('加载功能开关列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFlags();
  }, [fetchFlags]);

  const handleCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ value: false, scope: 'global' });
    setModalOpen(true);
  };

  const handleEdit = (record: FeatureFlag) => {
    setEditing(record);
    form.setFieldsValue({
      key: record.key,
      description: record.description,
      value: record.value,
      scope: record.scope,
      scopeValue: record.scopeValue || undefined,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    try {
      await featureFlagApi.upsert(values);
      message.success(editing ? '更新成功' : '创建成功');
      setModalOpen(false);
      fetchFlags();
    } catch {
      message.error('操作失败');
    }
  };

  const handleToggle = async (record: FeatureFlag, checked: boolean) => {
    try {
      await featureFlagApi.upsert({
        key: record.key,
        description: record.description,
        scope: record.scope,
        scopeValue: record.scopeValue,
        value: checked,
      });
      message.success(checked ? '已启用' : '已禁用');
      fetchFlags();
    } catch {
      message.error('操作失败');
    }
  };

  const columns = [
    {
      title: 'Key',
      dataIndex: 'key',
      key: 'key',
      width: 220,
      render: (key: string) => <Typography.Text code>{key}</Typography.Text>,
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
    {
      title: '当前值',
      dataIndex: 'value',
      key: 'value',
      width: 110,
      render: (value: boolean, record: FeatureFlag) => (
        <Switch
          checked={value}
          onChange={(checked) => handleToggle(record, checked)}
          checkedChildren="开"
          unCheckedChildren="关"
          disabled={!canManage}
          size="small"
        />
      ),
    },
    {
      title: '类型',
      key: 'type',
      width: 100,
      render: (_: unknown, record: FeatureFlag) => {
        const t = inferType(record);
        return <Tag variant={TYPE_VARIANTS[t]}>{t}</Tag>;
      },
    },
    {
      title: '命中规则',
      key: 'rule',
      width: 200,
      render: (_: unknown, record: FeatureFlag) => (
        <Space size={6}>
          <Tag variant={SCOPE_VARIANTS[record.scope] ?? 'muted'}>
            {SCOPE_OPTIONS.find((s) => s.value === record.scope)?.label || record.scope}
          </Tag>
          {record.scopeValue ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{record.scopeValue}</Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 90,
      render: (_: unknown, record: FeatureFlag) => (
        record.value ? <Tag variant="success">启用</Tag> : <Tag variant="muted">关闭</Tag>
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 170,
      render: (val: string) => val ? dayjs(val).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: '操作',
      key: 'actions',
      width: 100,
      align: 'right' as const,
      render: (_: unknown, record: FeatureFlag) => (
        <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} disabled={!canManage}>
          编辑
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="功能开关"
        subtitle="管理系统功能开关，控制功能的启用和禁用"
        actions={[
          <Button
            key="refresh"
            icon={<ReloadOutlined />}
            onClick={fetchFlags}
          >
            刷新
          </Button>,
          <Button
            key="new"
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleCreate}
            disabled={!canManage}
          >
            新建开关
          </Button>,
        ]}
      />

      <DataTable<FeatureFlag>
        dataSource={flags}
        columns={columns}
        rowKey="id"
        loading={loading}
        searchable
        searchPlaceholder="搜索 Key / 描述"
        scroll={{ x: 1080 }}
        pagination={false}
      />

      <Modal
        title={editing ? '编辑功能开关' : '新增功能开关'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="key" label="Key" rules={[{ required: true, message: '请输入 Key' }]}>
            <Input placeholder="如: enable_new_chat_ui" disabled={!!editing} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input placeholder="功能描述" />
          </Form.Item>
          <Form.Item name="value" label="默认值" valuePropName="checked">
            <Switch checkedChildren="开" unCheckedChildren="关" />
          </Form.Item>
          <Form.Item name="scope" label="作用域" rules={[{ required: true, message: '请选择作用域' }]}>
            <Select options={SCOPE_OPTIONS} placeholder="选择作用域" />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(prev, next) => prev.scope !== next.scope}
          >
            {({ getFieldValue }) =>
              getFieldValue('scope') && getFieldValue('scope') !== 'global' ? (
                <Form.Item name="scopeValue" label="作用对象">
                  <Input placeholder="如套餐 ID / 用户 ID" />
                </Form.Item>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
