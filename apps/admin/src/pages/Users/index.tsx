import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Form, Input, Modal, Popconfirm, Select, Space, Switch, Typography, message } from 'antd';
import { DownloadOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  PageHeader,
  FilterBar,
  DataTable,
  Tag,
} from '../../components/common';
import { userManageApi } from '../../api/admin';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { usePermission } from '../../hooks/usePermission';
import './Users.css';

type UserGroupValue = string | { id?: string | null; name?: string | null };

interface UserRecord {
  id: string;
  email: string | null;
  phone?: string | null;
  userType?: string | null;
  userGroup?: string | null;
  groupName?: string | null;
  userGroups?: UserGroupValue[] | null;
  groups?: UserGroupValue[] | null;
  nickname?: string | null;
  role: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt?: string | null;
  identityCount?: number;
  identityProviders?: string[];
  verifiedIdentityCount?: number;
}

interface SearchParams {
  search?: string;
  status?: string;
  role?: string;
  provider?: string;
}

const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'active', label: '启用' },
  { value: 'inactive', label: '停用' },
];

const ROLE_OPTIONS = [
  { value: 'all', label: '全部角色' },
  { value: 'USER', label: '普通用户' },
  { value: 'ADMIN', label: '管理员' },
];

const PROVIDER_OPTIONS = [
  { value: 'all', label: '全部认证' },
  { value: 'auth0', label: 'Auth0' },
  { value: 'authing', label: 'Authing' },
  { value: 'local', label: '本地' },
];

function displayName(row: UserRecord): string {
  return row.email || row.phone || row.id;
}

function formatDate(value?: string | null): string {
  if (!value) return '';
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD HH:mm') : '';
}

function formatUserType(value?: string | null): string {
  const normalized = value?.trim();
  if (!normalized) return '';
  const upper = normalized.toUpperCase();
  if (upper === 'ENTERPRISE') return '企业';
  if (upper === 'PERSONAL' || upper === 'INDIVIDUAL') return '个人';
  return normalized;
}

function userTypeVariant(value?: string | null): 'success' | 'proc' | 'muted' {
  const upper = value?.trim().toUpperCase();
  if (upper === 'ENTERPRISE') return 'proc';
  if (upper === 'PERSONAL' || upper === 'INDIVIDUAL') return 'success';
  return 'muted';
}

function groupLabel(group: UserGroupValue): string {
  if (typeof group === 'string') return group.trim();
  return group.name?.trim() || group.id?.trim() || '';
}

function userGroupLabels(row: UserRecord): string[] {
  const groups: UserGroupValue[] = [];
  if (row.userGroup) groups.push(row.userGroup);
  if (row.groupName) groups.push(row.groupName);
  if (Array.isArray(row.userGroups)) groups.push(...row.userGroups);
  if (Array.isArray(row.groups)) groups.push(...row.groups);
  return Array.from(new Set(groups.map(groupLabel).filter(Boolean)));
}

function normalizeProviders(row: UserRecord): string[] {
  const providers = (row.identityProviders ?? [])
    .map((provider) => provider.trim().toLowerCase())
    .filter(Boolean);
  if (providers.length > 0) return Array.from(new Set(providers));
  return ['local'];
}

function canResetLocalPassword(row: UserRecord): boolean {
  return normalizeProviders(row).includes('local');
}

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { message?: unknown } } }).response;
    if (typeof response?.data?.message === 'string' && response.data.message) {
      return response.data.message;
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export default function UsersPage() {
  const navigate = useNavigate();
  const canManage = usePermission('admin.page.users.manage');

  const [params, setParams] = useState<SearchParams>({});

  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createForm] = Form.useForm();

  const [editRecord, setEditRecord] = useState<UserRecord | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editForm] = Form.useForm();

  const [resetResult, setResetResult] = useState<{ email: string; tempPassword: string } | null>(null);

  const users = usePaginatedList<UserRecord>({
    pageSize: 20,
    deps: [params.search, params.status, params.role, params.provider],
    fetcher: useCallback(async ({ page, pageSize }) => {
      const res = await userManageApi.search({ ...params, page, pageSize });
      return {
        items: res.items ?? [],
        total: res.total ?? 0,
        page,
        pageSize,
      };
    }, [params]),
  });

  const items = users.items;

  const activeChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
    if (params.search) {
      chips.push({
        key: 'search',
        label: `搜索 ${params.search}`,
        onRemove: () => setParams((prev) => ({ ...prev, search: undefined })),
      });
    }
    if (params.status) {
      chips.push({
        key: 'status',
        label: params.status === 'active' ? '启用' : '停用',
        onRemove: () => setParams((prev) => ({ ...prev, status: undefined })),
      });
    }
    if (params.role) {
      chips.push({
        key: 'role',
        label: params.role === 'ADMIN' ? '管理员' : '普通用户',
        onRemove: () => setParams((prev) => ({ ...prev, role: undefined })),
      });
    }
    if (params.provider) {
      chips.push({
        key: 'provider',
        label: params.provider === 'auth0' ? 'Auth0' : '本地',
        onRemove: () => setParams((prev) => ({ ...prev, provider: undefined })),
      });
    }
    return chips;
  }, [params.provider, params.role, params.search, params.status]);

  const handleExport = () => {
    const header = [
      'userId',
      'phone',
      'email',
      'userType',
      'userGroups',
      'createdAt',
      'lastLoginAt',
    ];
    const lines = items.map((row) => [
      row.id,
      row.phone ?? '',
      row.email ?? '',
      formatUserType(row.userType),
      userGroupLabels(row).join('|'),
      row.createdAt,
      row.lastLoginAt ?? '',
    ].map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[header.join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `identity-users-${dayjs().format('YYYYMMDD-HHmm')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      setCreateLoading(true);
      await userManageApi.create(values);
      message.success('身份已创建');
      setCreateOpen(false);
      createForm.resetFields();
      users.reload();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error('创建失败，请重试');
    } finally {
      setCreateLoading(false);
    }
  };

  const openEdit = (record: UserRecord) => {
    setEditRecord(record);
    editForm.setFieldsValue({
      email: record.email,
      nickname: record.nickname,
      isActive: record.isActive,
    });
  };

  const handleEdit = async () => {
    if (!editRecord) return;
    try {
      const values = await editForm.validateFields();
      setEditLoading(true);
      await userManageApi.update(editRecord.id, values);
      message.success('身份已更新');
      setEditRecord(null);
      editForm.resetFields();
      users.reload();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error('更新失败，请重试');
    } finally {
      setEditLoading(false);
    }
  };

  const handleResetPassword = async (record: UserRecord) => {
    try {
      const res = await userManageApi.resetPassword(record.id);
      setResetResult({
        email: displayName(record),
        tempPassword: res.temporaryPassword ?? res.oneTimePassword ?? res.tempPassword ?? res.password ?? '（请查看后端日志）',
      });
    } catch (err) {
      message.error(errorMessage(err, '重置密码失败，请重试'));
    }
  };

  const columns = [
    {
      title: '用户ID',
      key: 'id',
      width: 300,
      render: (_: unknown, row: UserRecord) => (
        <Typography.Text
          className="identity-user-id"
          copyable={{ text: row.id, tooltips: ['复制用户 ID', '已复制'] }}
        >
          {row.id}
        </Typography.Text>
      ),
    },
    {
      title: 'phone',
      dataIndex: 'phone',
      key: 'phone',
      width: 150,
      render: (phone?: string | null) => phone || '',
    },
    {
      title: 'email',
      dataIndex: 'email',
      key: 'email',
      width: 220,
      render: (email?: string | null) => email || '',
    },
    {
      title: '用户类型',
      key: 'userType',
      width: 120,
      render: (_: unknown, row: UserRecord) => {
        const label = formatUserType(row.userType);
        return label ? <Tag variant={userTypeVariant(row.userType)}>{label}</Tag> : '';
      },
    },
    {
      title: '用户分组',
      key: 'userGroups',
      width: 190,
      render: (_: unknown, row: UserRecord) => {
        const labels = userGroupLabels(row);
        if (labels.length === 0) return '';
        return (
          <Space size={4} wrap>
            {labels.map((label) => (
              <Tag key={label} variant="muted">{label}</Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: '注册时间',
      key: 'createdAt',
      width: 170,
      render: (_: unknown, row: UserRecord) => formatDate(row.createdAt),
    },
    {
      title: '最后登录时间',
      key: 'lastLoginAt',
      width: 170,
      render: (_: unknown, row: UserRecord) => formatDate(row.lastLoginAt),
    },
    {
      title: '操作',
      key: 'op',
      width: 210,
      align: 'right' as const,
      render: (_: unknown, row: UserRecord) => {
        const resettable = canResetLocalPassword(row);
        return (
          <Space size={4}>
            <Button type="link" size="small" onClick={() => navigate(`/users/${row.id}`)}>
              查看
            </Button>
            {canManage && (
              <Button type="link" size="small" onClick={() => openEdit(row)}>
                编辑
              </Button>
            )}
            {canManage && resettable && (
              <Popconfirm title="确认重置本地登录密码？" onConfirm={() => handleResetPassword(row)}>
                <Button type="link" size="small">
                  重置密码
                </Button>
              </Popconfirm>
            )}
            {canManage && !resettable && (
              <Button
                type="link"
                size="small"
                disabled
                title="该身份使用 Auth0 或外部提供方登录，请走用户端忘记密码或身份提供方重置"
              >
                重置密码
              </Button>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div className="identity-page">
      <PageHeader
        title="用户管理"
        subtitle="只处理登录身份、认证方式和账号状态；产品账号进入订阅或按量运营处理"
        actions={[
          <Button key="exp" icon={<DownloadOutlined />} onClick={handleExport}>
            导出当前结果
          </Button>,
          <Button
            key="inv"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateOpen(true)}
            disabled={!canManage}
          >
            创建身份
          </Button>,
        ]}
      />

      <FilterBar
        search={{
          placeholder: '搜索用户ID / phone / email / 昵称',
          value: params.search ?? '',
          onSearch: (value) => setParams((prev) => ({ ...prev, search: value || undefined })),
        }}
        filters={[
          <Select
            key="status"
            value={params.status ?? 'all'}
            style={{ width: 128 }}
            options={STATUS_OPTIONS}
            onChange={(value) =>
              setParams((prev) => ({ ...prev, status: value === 'all' ? undefined : value }))
            }
          />,
          <Select
            key="role"
            value={params.role ?? 'all'}
            style={{ width: 128 }}
            options={ROLE_OPTIONS}
            onChange={(value) =>
              setParams((prev) => ({ ...prev, role: value === 'all' ? undefined : value }))
            }
          />,
          <Select
            key="provider"
            value={params.provider ?? 'all'}
            style={{ width: 128 }}
            options={PROVIDER_OPTIONS}
            onChange={(value) =>
              setParams((prev) => ({ ...prev, provider: value === 'all' ? undefined : value }))
            }
          />,
        ]}
        activeChips={activeChips}
        rightActions={(
          <Button icon={<ReloadOutlined />} onClick={users.reload}>
            刷新
          </Button>
        )}
      />

      <DataTable<UserRecord>
        columns={columns}
        dataSource={items}
        rowKey="id"
        loading={users.loading}
        scroll={{ x: 1320 }}
        listPagination={users.tablePagination}
      />

      <Modal
        title="创建身份"
        open={createOpen}
        onOk={handleCreate}
        onCancel={() => {
          setCreateOpen(false);
          createForm.resetFields();
        }}
        confirmLoading={createLoading}
        okText="创建"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={createForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="邮箱"
            name="email"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '请输入有效邮箱' },
            ]}
          >
            <Input placeholder="user@example.com" />
          </Form.Item>
          <Form.Item label="昵称" name="nickname">
            <Input placeholder="可选" />
          </Form.Item>
          <div className="identity-modal-note">
            系统会创建普通身份并发送 Auth0 邀请。
          </div>
        </Form>
      </Modal>

      <Modal
        title="编辑身份"
        open={!!editRecord}
        onOk={handleEdit}
        onCancel={() => {
          setEditRecord(null);
          editForm.resetFields();
        }}
        confirmLoading={editLoading}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="邮箱"
            name="email"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '请输入有效邮箱' },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item label="昵称" name="nickname">
            <Input placeholder="可选" />
          </Form.Item>
          <Form.Item label="账号状态" name="isActive" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="密码已重置"
        open={!!resetResult}
        onOk={() => setResetResult(null)}
        onCancel={() => setResetResult(null)}
        okText="确认"
        cancelButtonProps={{ style: { display: 'none' } }}
      >
        {resetResult && (
          <div>
            <p>
              身份 <strong>{resetResult.email}</strong> 的临时密码：
            </p>
            <Input.Password
              value={resetResult.tempPassword}
              readOnly
              style={{ fontFamily: 'monospace', fontSize: 16 }}
            />
            <p className="identity-modal-note">
              临时密码只适用于用户端邮箱/手机号 + 密码表单登录；不要使用 Auth0、Google 或 GitHub 入口。
              登录后请到用户端设置页修改密码。
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
