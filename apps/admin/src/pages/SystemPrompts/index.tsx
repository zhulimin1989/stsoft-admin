import { useState, useEffect, useCallback } from 'react';
import {
  Button,
  Modal,
  Form,
  Input,
  Select,
  Switch,
  Typography,
  message,
} from 'antd';
import { PlusOutlined, EditOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  PageHeader,
  DataTable,
  Tag,
} from '../../components/common';
import { systemPromptApi } from '../../api/admin';
import { usePermission } from '../../hooks/usePermission';

interface Prompt {
  id: string;
  name: string;
  content: string;
  description?: string | null;
  modelGroup?: string | null;
  version: number;
  isActive?: boolean;
  updatedAt: string;
}

const MODEL_GROUP_OPTIONS = [
  { label: 'GPT 系列', value: 'gpt' },
  { label: 'Claude 系列', value: 'claude' },
  { label: 'DeepSeek 系列', value: 'deepseek' },
  { label: '通用 (全部模型)', value: 'all' },
];

export default function SystemPromptsPage() {
  const canManage = usePermission('admin.page.system_prompts.manage');
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Prompt | null>(null);
  const [form] = Form.useForm();

  const fetchPrompts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await systemPromptApi.list();
      setPrompts(res?.items || res || []);
    } catch {
      message.error('加载提示词列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrompts();
  }, [fetchPrompts]);

  const handleCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ isActive: true, modelGroup: 'all' });
    setModalOpen(true);
  };

  const handleEdit = (prompt: Prompt) => {
    setEditing(prompt);
    form.setFieldsValue({
      name: prompt.name,
      description: prompt.description ?? '',
      modelGroup: prompt.modelGroup ?? 'all',
      content: prompt.content,
      isActive: prompt.isActive ?? true,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    try {
      await systemPromptApi.upsert({
        ...values,
        id: editing?.id,
      });
      message.success(editing ? '提示词已更新（版本自动递增）' : '提示词创建成功');
      setModalOpen(false);
      fetchPrompts();
    } catch {
      message.error('保存失败');
    }
  };

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: 200,
      render: (name: string) => <Typography.Text strong>{name}</Typography.Text>,
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (desc: string | null | undefined) =>
        desc || <Typography.Text type="secondary">未填写</Typography.Text>,
    },
    {
      title: '适用模型',
      dataIndex: 'modelGroup',
      key: 'modelGroup',
      width: 140,
      render: (group: string | null | undefined) => {
        if (!group) return <Typography.Text type="secondary">通用</Typography.Text>;
        const opt = MODEL_GROUP_OPTIONS.find((o) => o.value === group);
        return <Tag variant="proc">{opt?.label || group}</Tag>;
      },
    },
    {
      title: '版本',
      dataIndex: 'version',
      key: 'version',
      width: 80,
      render: (v: number) => <Tag variant="muted">v{v}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 100,
      render: (active: boolean | undefined) => (
        active === false
          ? <Tag variant="muted">下架</Tag>
          : <Tag variant="success">上架</Tag>
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
      render: (_: unknown, record: Prompt) => (
        <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} disabled={!canManage}>
          编辑
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="系统提示词"
        subtitle="管理系统内置的提示词模板，修改后版本号自动递增"
        actions={[
          <Button
            key="refresh"
            icon={<ReloadOutlined />}
            onClick={fetchPrompts}
            loading={loading}
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
            新建
          </Button>,
        ]}
      />

      <DataTable<Prompt>
        dataSource={prompts}
        columns={columns}
        rowKey="id"
        loading={loading}
        searchable
        searchPlaceholder="搜索 Key / 名称 / 描述"
        scroll={{ x: 1080 }}
        pagination={false}
      />

      <Modal
        title={editing ? `编辑提示词 - ${editing.name}` : '新建提示词'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
        width={840}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入提示词名称' }]}>
            <Input placeholder="如: system_prompt, chat_summarizer" disabled={!!editing} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input placeholder="说明该提示词的用途和适用场景" />
          </Form.Item>
          <Form.Item name="modelGroup" label="适用模型组">
            <Select options={MODEL_GROUP_OPTIONS} />
          </Form.Item>
          <Form.Item name="content" label="内容" rules={[{ required: true, message: '请输入提示词内容' }]}>
            <Input.TextArea
              rows={20}
              style={{
                fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
                fontSize: 13,
                lineHeight: 1.6,
              }}
              placeholder="输入系统提示词内容..."
            />
          </Form.Item>
          <Form.Item name="isActive" label="上架状态" valuePropName="checked">
            <Switch checkedChildren="上架" unCheckedChildren="下架" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
