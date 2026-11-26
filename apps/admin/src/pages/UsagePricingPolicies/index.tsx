import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Tag,
  message,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { DataTable, PageHeader, StableNumberInput } from '../../components/common';
import {
  productApi,
  usagePricingPolicyApi,
  type UsagePricingPolicy,
  type UsagePricingPolicyInput,
} from '../../api/admin';
import { userSegmentApi, type UserSegment } from '../../api/v2';
import { useCurrentProduct } from '../../hooks/useCurrentProduct';
import { usePermission } from '../../hooks/usePermission';
import { warnNonCritical } from '../../utils/logging';

interface ProductRow {
  id: string;
  name: string;
  billingMode?: string;
}

interface PolicyFormValues {
  scope: 'GLOBAL' | 'SEGMENT' | 'USER';
  userId?: string;
  userEmail?: string;
  segmentId?: string;
  modelName?: string;
  priceMultiplier: number;
  creditMultiplier?: number | null;
  priority?: number;
  description?: string;
  startsAt?: dayjs.Dayjs | null;
  endsAt?: dayjs.Dayjs | null;
  isActive: boolean;
}

const scopeLabel: Record<UsagePricingPolicy['scope'], string> = {
  GLOBAL: '全局',
  SEGMENT: '用户分群',
  USER: '单用户',
};

function toNumber(value: string | number | null | undefined, fallback = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export default function UsagePricingPoliciesPage() {
  const canManage = usePermission('admin.page.usage_pricing_policies.manage');
  const currentProductId = useCurrentProduct();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [productId, setProductId] = useState<string | undefined>(currentProductId ?? undefined);
  const [segments, setSegments] = useState<UserSegment[]>([]);
  const [items, setItems] = useState<UsagePricingPolicy[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UsagePricingPolicy | null>(null);
  const [form] = Form.useForm<PolicyFormValues>();
  const scope = Form.useWatch('scope', form);

  useEffect(() => {
    productApi
      .list()
      .then((res) => {
        const list = Array.isArray(res) ? res : res?.items || [];
        setProducts(list);
        setProductId((current) => current ?? list[0]?.id);
      })
      .catch(() => message.error('产品加载失败'));
    userSegmentApi
      .list({ pageSize: 100 })
      .then((res) => setSegments(res.items || []))
      .catch((error: unknown) => {
        warnNonCritical('UsagePricingPolicies segment preload', error);
      });
  }, []);

  useEffect(() => {
    if (currentProductId) setProductId(currentProductId);
  }, [currentProductId]);

  const loadPolicies = async (pid?: string) => {
    setLoading(true);
    try {
      setItems(await usagePricingPolicyApi.list(pid));
    } catch {
      message.error('策略加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPolicies(productId);
  }, [productId]);

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({
      scope: 'GLOBAL',
      priceMultiplier: 1,
      creditMultiplier: undefined,
      priority: 0,
      description: '',
      startsAt: dayjs(),
      endsAt: null,
      isActive: true,
    });
    setModalOpen(true);
  };

  const openEdit = (policy: UsagePricingPolicy) => {
    setEditing(policy);
    form.setFieldsValue({
      scope: policy.scope,
      userId: policy.userId ?? undefined,
      userEmail: policy.user?.email ?? undefined,
      segmentId: policy.segmentId ?? undefined,
      modelName: policy.modelName ?? undefined,
      priceMultiplier: toNumber(policy.priceMultiplier),
      creditMultiplier:
        policy.creditMultiplier == null ? undefined : toNumber(policy.creditMultiplier),
      priority: policy.priority,
      description: policy.description,
      startsAt: policy.startsAt ? dayjs(policy.startsAt) : null,
      endsAt: policy.endsAt ? dayjs(policy.endsAt) : null,
      isActive: policy.isActive,
    });
    setModalOpen(true);
  };

  const submit = async () => {
    if (!productId) return;
    try {
      const values = await form.validateFields();
      const payload: UsagePricingPolicyInput = {
        productId,
        scope: values.scope,
        userId: values.scope === 'USER' ? values.userId?.trim() || undefined : undefined,
        userEmail: values.scope === 'USER' ? values.userEmail?.trim() || undefined : undefined,
        segmentId: values.scope === 'SEGMENT' ? values.segmentId : undefined,
        modelName: values.modelName?.trim() || undefined,
        priceMultiplier: values.priceMultiplier,
        creditMultiplier: values.creditMultiplier ?? null,
        priority: values.priority ?? 0,
        description: values.description ?? '',
        startsAt: values.startsAt ? values.startsAt.toISOString() : null,
        endsAt: values.endsAt ? values.endsAt.toISOString() : null,
        isActive: values.isActive,
      };
      if (editing) {
        await usagePricingPolicyApi.update(editing.id, payload);
        message.success('策略已更新');
      } else {
        await usagePricingPolicyApi.create(payload);
        message.success('策略已创建');
      }
      setModalOpen(false);
      loadPolicies(productId);
    } catch (err: unknown) {
      if ((err as { errorFields?: unknown })?.errorFields) return;
      message.error('保存失败');
    }
  };

  const remove = (policy: UsagePricingPolicy) => {
    Modal.confirm({
      title: '删除用量折扣策略',
      content: policy.description || policy.id,
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        await usagePricingPolicyApi.delete(policy.id);
        message.success('已删除');
        loadPolicies(productId);
      },
    });
  };

  return (
    <>
      <PageHeader
        title="用量折扣策略"
        subtitle="按产品、模型、用户分群或单用户调整实际扣费倍率"
        actions={[
          <Button key="new" type="primary" icon={<PlusOutlined />} disabled={!canManage || !productId} onClick={openCreate}>
            新建策略
          </Button>,
        ]}
      />

      <Card>
        <Space style={{ marginBottom: 16 }}>
          <Select
            style={{ width: 260 }}
            placeholder="选择产品"
            value={productId}
            onChange={setProductId}
            options={products.map((product) => ({
              value: product.id,
              label: `${product.name}${product.billingMode ? ` (${product.billingMode})` : ''}`,
            }))}
          />
        </Space>

        <DataTable<UsagePricingPolicy>
          rowKey="id"
          loading={loading}
          dataSource={items}
          pagination={{ pageSize: 20 }}
          columns={[
            {
              title: '范围',
              dataIndex: 'scope',
              width: 120,
              render: (value: UsagePricingPolicy['scope']) => <Tag>{scopeLabel[value]}</Tag>,
            },
            {
              title: '对象',
              render: (_, record) => {
                if (record.scope === 'USER') {
                  return record.user?.email || record.userId || '-';
                }
                if (record.scope === 'SEGMENT') {
                  return record.segment?.name || record.segmentId || '-';
                }
                return '全部用户';
              },
            },
            {
              title: '模型',
              dataIndex: 'modelName',
              render: (value?: string | null) => value || '全部模型',
            },
            {
              title: '余额倍率',
              dataIndex: 'priceMultiplier',
              width: 110,
              render: (value: string) => `${toNumber(value).toFixed(4)}x`,
            },
            {
              title: '积分倍率',
              dataIndex: 'creditMultiplier',
              width: 110,
              render: (value?: string | null) => (value == null ? '-' : `${toNumber(value).toFixed(4)}x`),
            },
            {
              title: '优先级',
              dataIndex: 'priority',
              width: 90,
            },
            {
              title: '开始时间',
              dataIndex: 'startsAt',
              width: 150,
              render: (value?: string | null) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '立即'),
            },
            {
              title: '结束时间',
              dataIndex: 'endsAt',
              width: 150,
              render: (value?: string | null) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '长期'),
            },
            {
              title: '状态',
              dataIndex: 'isActive',
              width: 90,
              render: (value: boolean) => (value ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
            },
            {
              title: '说明',
              dataIndex: 'description',
              ellipsis: true,
            },
            {
              title: '操作',
              width: 140,
              render: (_, record) => (
                <Space>
                  <Button type="link" size="small" disabled={!canManage} onClick={() => openEdit(record)}>
                    编辑
                  </Button>
                  <Button type="link" size="small" danger disabled={!canManage} onClick={() => remove(record)}>
                    删除
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={editing ? '编辑用量折扣策略' : '新建用量折扣策略'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        destroyOnHidden
        okButtonProps={{ disabled: !canManage }}
      >
        <Form form={form} layout="vertical" disabled={!canManage}>
          <Form.Item name="scope" label="范围" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'GLOBAL', label: '全局' },
                { value: 'SEGMENT', label: '用户分群' },
                { value: 'USER', label: '单用户' },
              ]}
            />
          </Form.Item>

          {scope === 'USER' && (
            <>
              <Form.Item name="userEmail" label="用户邮箱">
                <Input allowClear />
              </Form.Item>
              <Form.Item name="userId" label="用户 ID">
                <Input allowClear />
              </Form.Item>
            </>
          )}

          {scope === 'SEGMENT' && (
            <Form.Item name="segmentId" label="用户分群" rules={[{ required: true, message: '请选择用户分群' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={segments.map((segment) => ({ value: segment.id, label: segment.name }))}
              />
            </Form.Item>
          )}

          <Form.Item name="modelName" label="模型">
            <Input allowClear placeholder="留空表示全部模型" />
          </Form.Item>

          <Space align="start">
            <Form.Item
              name="priceMultiplier"
              label="余额倍率"
              rules={[{ required: true, message: '请输入余额倍率' }]}
            >
              <StableNumberInput min={0} max={100} precision={4} step={0.05} style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="creditMultiplier" label="积分倍率">
              <StableNumberInput min={0} max={100} precision={4} step={0.05} style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="priority" label="优先级">
              <StableNumberInput min={0} precision={0} style={{ width: 120 }} />
            </Form.Item>
          </Space>

          <Form.Item name="description" label="说明">
            <Input.TextArea rows={3} />
          </Form.Item>

          <Space align="start">
            <Form.Item name="startsAt" label="开始时间">
              <DatePicker showTime allowClear style={{ width: 220 }} />
            </Form.Item>
            <Form.Item name="endsAt" label="结束时间">
              <DatePicker showTime allowClear style={{ width: 220 }} />
            </Form.Item>
          </Space>

          <Form.Item name="isActive" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
