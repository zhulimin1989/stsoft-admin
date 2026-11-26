import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { expandAdminPermissions } from '@ruidong/shared';
import { PlusOutlined } from '@ant-design/icons';
import {
  PageHeader,
  StatCard,
  StatCardGroup,
  DataTable,
  Tag,
  type TagVariant,
} from '../../components/common';
import { adminRoleApi } from '../../api/admin';
import { usePermission } from '../../hooks/usePermission';
import {
  PAGE_PERMISSION_GROUPS,
  PERMISSION_LABELS,
  type PagePermissionDefinition,
} from '../../config/permissions';

interface AdminRole {
  id: string;
  key: string | null;
  name: string;
  description: string;
  permissions: string;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

const ROLE_KEY_VARIANTS: Record<string, TagVariant> = {
  super_admin: 'error',
  admin: 'warn',
  operator: 'proc',
  finance: 'success',
  viewer: 'muted',
};

function parsePermissions(permStr: string): string[] {
  try {
    const parsed = JSON.parse(permStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function PagePermissionRow({
  page,
  disabled,
  onViewChange,
  onOperationChange,
}: {
  page: PagePermissionDefinition;
  disabled?: boolean;
  onViewChange: (checked: boolean) => void;
  onOperationChange: (permission: string, checked: boolean) => void;
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '10px 12px',
      background: disabled ? '#fcfcfc' : '#fafafa',
      borderRadius: 8,
      border: '1px solid #f0f0f0',
      gap: 12,
    }}>
      <span style={{ fontWeight: 500, fontSize: 13, minWidth: 120 }}>{page.label}</span>
      <Space size={16} wrap>
        <Form.Item name={pageFieldName(page.key, 'view')} valuePropName="checked" noStyle>
          <Checkbox disabled={disabled} onChange={(event) => onViewChange(event.target.checked)}>
            查看
          </Checkbox>
        </Form.Item>
        {page.manage ? (
          <Form.Item name={pageFieldName(page.key, 'manage')} valuePropName="checked" noStyle>
            <Checkbox
              disabled={disabled}
              onChange={(event) => onOperationChange(page.manage!, event.target.checked)}
            >
              管理
            </Checkbox>
          </Form.Item>
        ) : null}
        {(page.actions ?? []).map((action) => (
          <Form.Item
            key={action.key}
            name={pageFieldName(page.key, 'action', action.key)}
            valuePropName="checked"
            noStyle
          >
            <Checkbox
              disabled={disabled}
              onChange={(event) => onOperationChange(action.key, event.target.checked)}
            >
              {action.label}
            </Checkbox>
          </Form.Item>
        ))}
      </Space>
    </div>
  );
}

function pageFieldName(pageKey: string, kind: 'view' | 'manage' | 'action', actionKey?: string) {
  return `page_${pageKey}_${kind}${actionKey ? `_${actionKey.replace(/[^a-z0-9]+/gi, '_')}` : ''}`;
}

function pagePermsToValues(perms: string[]): Record<string, boolean> {
  const expanded = new Set<string>(expandAdminPermissions(perms));
  const values: Record<string, boolean> = {};
  for (const group of PAGE_PERMISSION_GROUPS) {
    for (const page of group.pages) {
      values[pageFieldName(page.key, 'view')] = expanded.has(page.view);
      if (page.manage) {
        values[pageFieldName(page.key, 'manage')] = expanded.has(page.manage);
      }
      for (const action of page.actions ?? []) {
        values[pageFieldName(page.key, 'action', action.key)] = expanded.has(action.key);
      }
    }
  }
  return values;
}

function pageValuesToPerms(values: Record<string, unknown>): string[] {
  const permissions: string[] = [];
  for (const group of PAGE_PERMISSION_GROUPS) {
    for (const page of group.pages) {
      if (values[pageFieldName(page.key, 'view')] === true) permissions.push(page.view);
      if (page.manage && values[pageFieldName(page.key, 'manage')] === true) {
        permissions.push(page.manage);
      }
      for (const action of page.actions ?? []) {
        if (values[pageFieldName(page.key, 'action', action.key)] === true) {
          permissions.push(action.key);
        }
      }
    }
  }
  return permissions;
}

function allPageFieldDefaults(): Record<string, boolean> {
  return pagePermsToValues([]);
}

export default function RolesPage() {
  const canManageRoles = usePermission('admin.page.roles.manage');
  const [data, setData] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminRole | null>(null);
  const [form] = Form.useForm();

  const fetchRoles = async () => {
    setLoading(true);
    try {
      const res = await adminRoleApi.list();
      const items = Array.isArray(res) ? res : [];
      setData(items.sort((a, b) => a.sortOrder - b.sortOrder));
    } catch {
      message.error('角色列表加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRoles();
  }, []);

  const summary = useMemo(() => {
    const total = data.length;
    const custom = data.filter((item) => !item.isSystem).length;
    const topRole = data.reduce<AdminRole | null>((acc, item) => {
      if (!acc) return item;
      return (item.memberCount ?? 0) > (acc.memberCount ?? 0) ? item : acc;
    }, null);
    return {
      total,
      custom,
      topName: topRole?.name ?? '—',
      topCount: topRole?.memberCount ?? 0,
    };
  }, [data]);

  const openCreate = () => {
    setEditTarget(null);
    form.resetFields();
    form.setFieldsValue(allPageFieldDefaults());
    setDrawerOpen(true);
  };

  const openEdit = (record: AdminRole) => {
    setEditTarget(record);
    const perms = parsePermissions(record.permissions);
    form.setFieldsValue({
      name: record.name,
      description: record.description,
      ...pagePermsToValues(perms),
    });
    setDrawerOpen(true);
  };

  const closeModal = () => {
    setDrawerOpen(false);
    setEditTarget(null);
    form.resetFields();
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const perms = [...new Set(pageValuesToPerms(values))];
      const payload = {
        name: values.name.trim(),
        description: values.description?.trim() || '',
        permissions: JSON.stringify(perms),
      };

      if (editTarget) {
        await adminRoleApi.update(editTarget.id, payload);
        message.success('角色已更新');
      } else {
        await adminRoleApi.create(payload);
        message.success('角色已创建');
      }
      closeModal();
      await fetchRoles();
    } catch (error) {
      if (error && typeof error === 'object' && 'errorFields' in error) return;
      message.error('保存失败，请检查角色配置');
    }
  };

  const handleDelete = async (record: AdminRole) => {
    try {
      await adminRoleApi.delete(record.id);
      message.success('角色已删除');
      await fetchRoles();
    } catch {
      message.error('删除失败，请稍后再试');
    }
  };

  const handlePageViewChange = (page: PagePermissionDefinition, checked: boolean) => {
    if (checked) return;
    if (page.manage) form.setFieldValue(pageFieldName(page.key, 'manage'), false);
    for (const action of page.actions ?? []) {
      form.setFieldValue(pageFieldName(page.key, 'action', action.key), false);
    }
  };

  const handlePageOperationChange = (
    page: PagePermissionDefinition,
    permission: string,
    checked: boolean,
  ) => {
    if (!checked) return;
    form.setFieldValue(pageFieldName(page.key, 'view'), true);
    if (permission.endsWith('.export')) {
      const exportJobs = PAGE_PERMISSION_GROUPS
        .flatMap((group) => group.pages)
        .find((candidate) => candidate.key === 'finance_export_jobs');
      if (exportJobs) {
        form.setFieldValue(pageFieldName(exportJobs.key, 'view'), true);
        for (const action of exportJobs.actions ?? []) {
          form.setFieldValue(pageFieldName(exportJobs.key, 'action', action.key), true);
        }
      }
    }
  };

  const columns = [
    {
      title: '角色名',
      dataIndex: 'name',
      key: 'name',
      width: 200,
      render: (name: string, record: AdminRole) => {
        const variant = record.key ? ROLE_KEY_VARIANTS[record.key] ?? 'muted' : 'muted';
        return (
          <Space size={8} wrap>
            <Typography.Text strong>{name}</Typography.Text>
            {record.key ? <Tag variant={variant}>{record.key}</Tag> : null}
            {record.isSystem ? <Tag variant="warn">系统</Tag> : null}
          </Space>
        );
      },
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (description: string) => description || <Typography.Text type="secondary">未填写</Typography.Text>,
    },
    {
      title: '用户数',
      dataIndex: 'memberCount',
      key: 'memberCount',
      width: 90,
      render: (count: number) => count ?? 0,
    },
    {
      title: '权限数',
      key: 'permCount',
      width: 90,
      render: (_: unknown, record: AdminRole) => parsePermissions(record.permissions).length,
    },
    {
      title: '权限摘要',
      key: 'permissions',
      width: 320,
      render: (_: unknown, record: AdminRole) => {
        const perms = parsePermissions(record.permissions);
        const labels = perms.map((permission) => PERMISSION_LABELS[permission]).filter(Boolean);
        const shown = labels.slice(0, 4);
        const rest = labels.length - shown.length;
        return labels.length > 0 ? (
          <Space size={4} wrap>
            {shown.map((label) => <Tag key={label} variant="muted">{label}</Tag>)}
            {rest > 0 ? (
              <Tooltip title={labels.slice(4).join('、')}>
                <Tag variant="muted">+{rest}</Tag>
              </Tooltip>
            ) : null}
          </Space>
        ) : <Typography.Text type="secondary">未配置</Typography.Text>;
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      align: 'right' as const,
      render: (_: unknown, record: AdminRole) => {
        if (record.isSystem) {
          return <Button type="link" size="small" onClick={() => openEdit(record)}>详情</Button>;
        }
        return (
          <Space size={0}>
            <Button type="link" size="small" onClick={() => openEdit(record)}>详情</Button>
            {canManageRoles ? (
              <Button type="link" size="small" onClick={() => openEdit(record)}>编辑</Button>
            ) : null}
            {canManageRoles && record.memberCount > 0 ? (
              <Tooltip title={`该角色下仍有 ${record.memberCount} 个账号，请先转移成员`}>
                <Typography.Text type="secondary" style={{ padding: '0 8px', fontSize: 12 }}>
                  有成员
                </Typography.Text>
              </Tooltip>
            ) : canManageRoles ? (
              <Popconfirm
                title={`确定删除角色「${record.name}」？`}
                onConfirm={() => void handleDelete(record)}
                okText="删除"
                cancelText="取消"
              >
                <Button type="link" size="small" danger>删除</Button>
              </Popconfirm>
            ) : null}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="角色权限"
        subtitle="管理后台角色定义 + 权限分配"
        actions={canManageRoles ? [
          <Button
            key="new"
            type="primary"
            icon={<PlusOutlined />}
            onClick={openCreate}
          >
            新建角色
          </Button>,
        ] : []}
      />

      <StatCardGroup columns={3}>
        <StatCard label="角色数" value={summary.total} />
        <StatCard
          label="用户最多角色"
          value={`${summary.topName} · ${summary.topCount}`}
        />
        <StatCard label="自定义角色数" value={summary.custom} />
      </StatCardGroup>

      <Alert
        type="info"
        showIcon
        message="系统角色仅用于审查和对比权限，不可直接修改；若要调整权限边界，请新建自定义角色。"
        style={{ marginBottom: 16 }}
      />

      <DataTable<AdminRole>
        columns={columns}
        dataSource={data}
        rowKey="id"
        loading={loading}
        searchable
        searchPlaceholder="搜索角色 / 权限"
        pagination={false}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="还没有角色数据。建议先保留系统角色，再按岗位补充自定义角色。"
            />
          ),
        }}
        scroll={{ x: 1080 }}
      />

      <Modal
        title={editTarget ? (editTarget.isSystem ? `查看角色 - ${editTarget.name}` : `编辑角色 - ${editTarget.name}`) : '新建角色'}
        open={drawerOpen}
        onOk={editTarget?.isSystem || !canManageRoles ? undefined : () => void handleSave()}
        onCancel={closeModal}
        width={820}
        destroyOnClose
        okText="保存"
        footer={editTarget?.isSystem || !canManageRoles ? <Button onClick={closeModal}>关闭</Button> : undefined}
        styles={{ body: { maxHeight: '72vh', overflowY: 'auto' } }}
      >
        <Form form={form} layout="vertical" preserve={false}>
          {editTarget?.isSystem ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="系统角色仅供查看，不能在界面中直接修改。"
            />
          ) : null}

          <Form.Item
            name="name"
            label="角色名称"
            rules={[{ required: true, message: '请输入角色名称' }]}
          >
            <Input placeholder="例如：运营编辑" disabled={editTarget?.isSystem || !canManageRoles} />
          </Form.Item>
          <Form.Item name="description" label="角色说明">
            <Input.TextArea rows={2} placeholder="描述该角色负责的范围" disabled={editTarget?.isSystem || !canManageRoles} />
          </Form.Item>

          <Typography.Text strong style={{ display: 'block', marginBottom: 12 }}>页面与操作权限</Typography.Text>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="页面权限控制菜单、直接访问和读取接口；管理、导出、下载权限控制页面内操作。"
          />
          <Collapse
            defaultActiveKey={['overview']}
            items={PAGE_PERMISSION_GROUPS.map((group) => ({
              key: group.key,
              label: `${group.label}（${group.pages.length} 个页面）`,
              children: (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {group.pages.map((page) => (
                    <PagePermissionRow
                      key={page.key}
                      page={page}
                      disabled={editTarget?.isSystem || !canManageRoles}
                      onViewChange={(checked) => handlePageViewChange(page, checked)}
                      onOperationChange={(permission, checked) =>
                        handlePageOperationChange(page, permission, checked)
                      }
                    />
                  ))}
                </Space>
              ),
            }))}
          />

        </Form>
      </Modal>
    </div>
  );
}
