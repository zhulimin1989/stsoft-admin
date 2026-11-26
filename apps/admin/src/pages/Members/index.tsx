import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Divider,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import {
  PageHeader,
  StatCard,
  StatCardGroup,
  FilterBar,
  DataTable,
  Tag,
  type TagVariant,
} from '../../components/common';
import { adminMemberApi, adminRoleApi } from '../../api/admin';
import { usePermission } from '../../hooks/usePermission';

interface AdminRole {
  id: string;
  key: string | null;
  name: string;
  isSystem: boolean;
}

interface AdminMember {
  id: string;
  email: string;
  nickname: string;
  name: string;
  phone: string | null;
  department: string | null;
  presetRole: string;
  roleId: string | null;
  roleName: string | null;
  permissions: Record<string, boolean>;
  resolvedPermissions: string[];
  isActive: boolean;
  invitedBy: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

const ROLE_KEY_VARIANTS: Record<string, TagVariant> = {
  super_admin: 'error',
  admin: 'warn',
  operator: 'proc',
  finance: 'success',
  viewer: 'muted',
};

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay} 天前`;
  return date.toLocaleDateString();
}

export default function MembersPage() {
  const canManage = usePermission('admin.page.members.manage');
  const [data, setData] = useState<AdminMember[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminMember | null>(null);
  const [credentialInfo, setCredentialInfo] = useState<{ email: string; password: string } | null>(null);
  const [inviteForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const res = await adminMemberApi.list();
      setData(Array.isArray(res) ? res : res.items ?? []);
    } catch {
      message.error('管理员列表加载失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchRoles = async () => {
    try {
      const res = await adminRoleApi.list();
      setRoles(Array.isArray(res) ? res : []);
    } catch {
      message.error('角色选项加载失败');
    }
  };

  useEffect(() => {
    void fetchMembers();
    void fetchRoles();
  }, []);

  const assignableRoles = roles.filter((role) => role.key !== 'super_admin');

  const summary = useMemo(() => {
    const total = data.length;
    const active = data.filter((item) => item.isActive).length;
    const inactive = total - active;
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentActive = data.filter(
      (item) => item.lastLoginAt && new Date(item.lastLoginAt).getTime() >= cutoff,
    ).length;
    return { total, active, inactive, recentActive };
  }, [data]);

  const filteredData = useMemo(() => {
    return data.filter((item) => {
      if (search) {
        const q = search.toLowerCase();
        const haystack = `${item.email} ${item.name ?? ''} ${item.nickname ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (roleFilter !== 'all') {
        if (roleFilter === '__preset__super_admin') {
          if (item.presetRole !== 'super_admin') return false;
        } else if (item.roleId !== roleFilter) {
          return false;
        }
      }
      if (statusFilter !== 'all') {
        if (statusFilter === 'active' && !item.isActive) return false;
        if (statusFilter === 'inactive' && item.isActive) return false;
      }
      return true;
    });
  }, [data, search, roleFilter, statusFilter]);

  const closeInvite = () => {
    setInviteOpen(false);
    inviteForm.resetFields();
  };

  const closeEdit = () => {
    setEditTarget(null);
    editForm.resetFields();
  };

  const handleInvite = async () => {
    try {
      const values = await inviteForm.validateFields();
      const result = await adminMemberApi.invite({
        email: values.email,
        roleId: values.roleId,
        name: values.name,
        phone: values.phone || undefined,
        department: values.department || undefined,
      });
      closeInvite();
      setCredentialInfo({ email: values.email, password: result.temporaryPassword });
      message.success('管理员邀请成功');
      await fetchMembers();
    } catch (error) {
      if (error && typeof error === 'object' && 'errorFields' in error) return;
      message.error('邀请失败，请检查邮箱或角色配置');
    }
  };

  const handleEdit = async () => {
    if (!editTarget) return;
    try {
      const values = await editForm.validateFields();
      await adminMemberApi.update(editTarget.id, {
        roleId: values.roleId,
        name: values.name,
        phone: values.phone || null,
        department: values.department || null,
      });
      message.success('管理员信息已更新');
      closeEdit();
      await fetchMembers();
    } catch (error) {
      if (error && typeof error === 'object' && 'errorFields' in error) return;
      message.error('更新失败');
    }
  };

  const handleToggleStatus = async (record: AdminMember) => {
    try {
      await adminMemberApi.update(record.id, { isActive: !record.isActive });
      message.success(record.isActive ? '管理员已停用' : '管理员已启用');
      await fetchMembers();
    } catch {
      message.error('状态切换失败');
    }
  };

  const handleRemove = async (record: AdminMember) => {
    try {
      await adminMemberApi.remove(record.id);
      message.success('管理员已移除');
      await fetchMembers();
    } catch {
      message.error('移除失败');
    }
  };

  const handleForceLogout = async (record: AdminMember) => {
    try {
      await adminMemberApi.forceLogout(record.id);
      message.success('已强制下线');
    } catch {
      message.error('强制下线失败');
    }
  };

  const handleResetPassword = async (record: AdminMember) => {
    try {
      const result = await adminMemberApi.resetPassword(record.id);
      setCredentialInfo({ email: record.email, password: result.tempPassword });
      message.success('密码已重置');
    } catch {
      message.error('重置密码失败');
    }
  };

  const openEdit = (record: AdminMember) => {
    setEditTarget(record);
    editForm.setFieldsValue({
      name: record.name || '',
      phone: record.phone || '',
      department: record.department || '',
      roleId: record.roleId || undefined,
    });
  };

  const hasCustomPerms = (record: AdminMember) => {
    return !!record.permissions && Object.keys(record.permissions).length > 0;
  };

  const columns = [
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
      width: 220,
      render: (email: string, record: AdminMember) => (
        <Space size={6}>
          <Typography.Text>{email}</Typography.Text>
          {record.presetRole === 'super_admin' ? <Tag variant="error">Root</Tag> : null}
        </Space>
      ),
    },
    {
      title: '昵称',
      key: 'nickname',
      width: 160,
      render: (_: unknown, record: AdminMember) =>
        record.name || record.nickname || <Typography.Text type="secondary">-</Typography.Text>,
    },
    {
      title: '角色',
      key: 'role',
      width: 140,
      render: (_: unknown, record: AdminMember) => {
        const variant = record.presetRole && ROLE_KEY_VARIANTS[record.presetRole]
          ? ROLE_KEY_VARIANTS[record.presetRole]
          : 'muted';
        return (
          <Tag variant={variant}>{record.roleName || record.presetRole || '-'}</Tag>
        );
      },
    },
    {
      title: '自定义权限',
      key: 'customPerms',
      width: 110,
      render: (_: unknown, record: AdminMember) => (
        hasCustomPerms(record)
          ? <Tag variant="proc">有</Tag>
          : <Tag variant="muted">无</Tag>
      ),
    },
    {
      title: '最近登录',
      dataIndex: 'lastLoginAt',
      key: 'lastLoginAt',
      width: 130,
      render: (value: string | null) => value ? (
        <Tooltip title={new Date(value).toLocaleString()}>
          <span>{formatRelativeTime(value)}</span>
        </Tooltip>
      ) : '-',
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 90,
      render: (active: boolean) => (
        <Tag variant={active ? 'success' : 'muted'}>{active ? '正常' : '停用'}</Tag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 220,
      align: 'right' as const,
      render: (_: unknown, record: AdminMember) => {
        if (record.presetRole === 'super_admin') {
          return <Tag variant="error">系统账号</Tag>;
        }
        if (!canManage) {
          return <Typography.Text type="secondary">—</Typography.Text>;
        }
        return (
          <Space size={0} wrap>
            <Button type="link" size="small" onClick={() => openEdit(record)}>编辑角色</Button>
            <Popconfirm
              title="确定重置此管理员的密码？"
              onConfirm={() => void handleResetPassword(record)}
              okText="确定"
              cancelText="取消"
            >
              <Button type="link" size="small">重置密码</Button>
            </Popconfirm>
            <Button type="link" size="small" onClick={() => void handleToggleStatus(record)}>
              {record.isActive ? '禁用' : '启用'}
            </Button>
            <Popconfirm title={`确定移除管理员 ${record.email}？`} onConfirm={() => void handleRemove(record)} okText="移除" cancelText="取消">
              <Button type="link" size="small" danger>移除</Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="后台账号"
        subtitle="管理后台成员、角色分配和安全操作"
        actions={canManage ? [
          <Button
            key="invite"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setInviteOpen(true)}
            disabled={assignableRoles.length === 0}
          >
            邀请成员
          </Button>,
        ] : []}
      />

      <StatCardGroup columns={4}>
        <StatCard label="管理员总数" value={summary.total} />
        <StatCard label="启用" value={summary.active} variant="success" />
        <StatCard label="禁用" value={summary.inactive} />
        <StatCard label="30 天活跃" value={summary.recentActive} variant="success" />
      </StatCardGroup>

      <FilterBar
        search={{
          placeholder: '搜索邮箱 / 昵称',
          onSearch: setSearch,
        }}
        filters={[
          <Select
            key="role"
            value={roleFilter}
            style={{ width: 150 }}
            onChange={setRoleFilter}
            options={[
              { value: 'all', label: '全部角色' },
              { value: '__preset__super_admin', label: 'Root' },
              ...roles.map((r) => ({ value: r.id, label: r.name })),
            ]}
          />,
          <Select
            key="status"
            value={statusFilter}
            style={{ width: 130 }}
            onChange={setStatusFilter}
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'active', label: '正常' },
              { value: 'inactive', label: '停用' },
            ]}
          />,
        ]}
      />

      <Alert
        type="warning"
        showIcon
        message="Super Admin 为系统根账号，界面只展示状态，不允许编辑、禁用或移除。"
        style={{ marginBottom: 16 }}
      />

      <DataTable<AdminMember>
        columns={columns}
        dataSource={filteredData}
        rowKey="id"
        loading={loading}
        pagination={false}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="还没有后台成员。建议先邀请运营或财务角色，避免所有操作都依赖 Root 账号。"
            />
          ),
        }}
        scroll={{ x: 1200 }}
      />

      <Modal
        title="邀请成员"
        open={inviteOpen}
        onOk={() => void handleInvite()}
        onCancel={closeInvite}
        destroyOnClose
        okText="发送邀请"
      >
        <Form form={inviteForm} layout="vertical" preserve={false}>
          <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email', message: '请输入有效邮箱' }]}>
            <Input placeholder="admin@example.com" />
          </Form.Item>
          <Form.Item name="name" label="昵称" rules={[{ required: true, message: '请输入昵称' }]}>
            <Input placeholder="昵称" />
          </Form.Item>
          <Form.Item name="phone" label="手机">
            <Input placeholder="选填" />
          </Form.Item>
          <Form.Item name="department" label="部门">
            <Input placeholder="选填" />
          </Form.Item>
          <Form.Item name="roleId" label="预设角色" rules={[{ required: true, message: '请选择角色' }]}>
            <Select placeholder="选择角色">
              {assignableRoles.map((role) => (
                <Select.Option key={role.id} value={role.id}>{role.name}</Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`编辑管理员 - ${editTarget?.email ?? ''}`}
        open={!!editTarget}
        onOk={() => void handleEdit()}
        onCancel={closeEdit}
        width={560}
        destroyOnClose
        okText="保存"
      >
        <Form form={editForm} layout="vertical" preserve={false}>
          <Typography.Text strong style={{ display: 'block', marginBottom: 12 }}>基本信息</Typography.Text>
          <Form.Item name="name" label="昵称" rules={[{ required: true, message: '请输入昵称' }]}>
            <Input placeholder="昵称" />
          </Form.Item>
          <Form.Item name="phone" label="手机">
            <Input placeholder="选填" />
          </Form.Item>
          <Form.Item name="department" label="部门">
            <Input placeholder="选填" />
          </Form.Item>

          <Typography.Text strong style={{ display: 'block', marginBottom: 12 }}>角色</Typography.Text>
          <Form.Item name="roleId" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
            <Select placeholder="选择角色">
              {assignableRoles.map((role) => (
                <Select.Option key={role.id} value={role.id}>{role.name}</Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Divider />
          <Typography.Text strong style={{ display: 'block', marginBottom: 12 }}>安全操作</Typography.Text>
          <Space wrap>
            <Popconfirm
              title="确定重置此管理员的密码？"
              onConfirm={() => editTarget && handleResetPassword(editTarget)}
              okText="确定"
              cancelText="取消"
            >
              <Button danger>重置密码</Button>
            </Popconfirm>
            <Popconfirm
              title="确定强制下线此管理员？"
              onConfirm={() => editTarget && handleForceLogout(editTarget)}
              okText="确定"
              cancelText="取消"
            >
              <Button>强制下线</Button>
            </Popconfirm>
          </Space>
        </Form>
      </Modal>

      <Modal
        title="管理员密码"
        open={!!credentialInfo}
        onOk={() => setCredentialInfo(null)}
        onCancel={() => setCredentialInfo(null)}
        cancelButtonProps={{ style: { display: 'none' } }}
        okText="我已记录"
      >
        {credentialInfo ? (
          <div>
            <p><strong>邮箱：</strong>{credentialInfo.email}</p>
            <p><strong>密码：</strong>
              <code style={{ padding: '2px 8px', background: '#f5f5f5', borderRadius: 4, fontSize: 14, userSelect: 'all' }}>
                {credentialInfo.password}
              </code>
            </p>
            <p style={{ color: '#d4380d', marginTop: 16 }}>请尽快通知管理员修改临时密码，此密码仅展示一次。</p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
