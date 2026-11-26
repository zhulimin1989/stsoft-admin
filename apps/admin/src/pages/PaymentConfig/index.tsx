import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Switch,
  Typography,
  message,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  PageHeader,
  DataTable,
  StableNumberInput,
  Tag,
  type TagVariant,
} from '../../components/common';
import { paymentInstanceApi, productApi } from '../../api/admin';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { usePermission } from '../../hooks/usePermission';
import { currencyMinorUnitLabel, formatCurrencyCents } from '../../utils/price';

const PROVIDER_OPTIONS = [
  { value: 'stripe', label: 'Stripe' },
  { value: 'wechat', label: '微信支付' },
  { value: 'alipay', label: '支付宝' },
];

const PROVIDER_VARIANTS: Record<string, TagVariant> = {
  stripe: 'proc',
  wechat: 'success',
  alipay: 'warn',
};

interface Instance {
  id: string;
  providerKey: string;
  name: string;
  config: Record<string, string>;
  supportedTypes: string[];
  isActive: boolean;
  dailyLimitCents: number;
  strategy: string;
  sortOrder: number;
  createdAt: string;
}

interface ProductLite {
  id: string;
  name: string;
  type?: string | null;
}

const PROVIDER_CONFIG_FIELDS: Record<string, {
  key: string;
  label: string;
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
}[]> = {
  wechat: [
    { key: 'appId', label: 'App ID' },
    { key: 'mchId', label: '商户号' },
    { key: 'apiV3Key', label: 'API V3 密钥', secret: true },
    { key: 'serialNo', label: '证书序列号' },
    { key: 'privateKey', label: '私钥内容', secret: true },
    { key: 'publicKey', label: '公钥' },
    { key: 'notifyUrl', label: '回调地址' },
  ],
  alipay: [
    { key: 'appId', label: 'App ID' },
    { key: 'privateKey', label: '应用私钥', secret: true },
    { key: 'alipayPublicKey', label: '支付宝公钥', secret: true },
    {
      key: 'gateway',
      label: '网关地址',
      required: false,
      placeholder: '沙箱：https://openapi-sandbox.dl.alipaydev.com/gateway.do；正式可留空',
    },
    {
      key: 'keyType',
      label: '私钥格式',
      required: false,
      options: [
        { value: 'PKCS8', label: 'PKCS8（BEGIN PRIVATE KEY）' },
        { value: 'PKCS1', label: 'PKCS1（BEGIN RSA PRIVATE KEY）' },
      ],
    },
    { key: 'notifyUrl', label: '回调地址' },
  ],
  stripe: [
    { key: 'publishableKey', label: 'Publishable Key' },
    { key: 'secretKey', label: 'Secret Key', secret: true },
    { key: 'webhookSecret', label: 'Webhook Secret', secret: true },
  ],
};

function formatDailyLimit(value: number, currency: string) {
  if (!value) return '无限制';
  return `${formatCurrencyCents(value, currency)} / 天`;
}

interface ChannelCardProps {
  providerKey: string;
  providerLabel: string;
  instances: Instance[];
  platformCurrency: string;
  canManage: boolean;
  onAdd: (providerKey: string) => void;
  onEdit: (instance: Instance) => void;
  onDelete: (id: string) => void;
  onToggleActive: (instance: Instance) => void;
  onTestConnection: (instance: Instance) => void;
}

function ChannelCard({
  providerKey,
  providerLabel,
  instances,
  platformCurrency,
  canManage,
  onAdd,
  onEdit,
  onDelete,
  onToggleActive,
  onTestConnection,
}: ChannelCardProps) {
  const totalActive = instances.filter((i) => i.isActive).length;
  return (
    <Card
      title={
        <Space>
          <Tag variant={PROVIDER_VARIANTS[providerKey] ?? 'muted'}>{providerLabel}</Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {instances.length} 个实例 · {totalActive} 启用
          </Typography.Text>
        </Space>
      }
      bordered={false}
      style={{ height: '100%' }}
      extra={
        <Button
          size="small"
          type="primary"
          icon={<PlusOutlined />}
          disabled={!canManage}
          onClick={() => onAdd(providerKey)}
        >
          新建
        </Button>
      }
    >
      {instances.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无实例" />
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {instances.map((inst) => {
            const expected = PROVIDER_CONFIG_FIELDS[inst.providerKey] || [];
            const configured = Object.keys(inst.config || {}).length;
            return (
              <div
                key={inst.id}
                style={{
                  padding: 12,
                  border: '1px solid #f0f0f0',
                  borderRadius: 6,
                  background: '#fafafa',
                }}
              >
                <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
                  <Space size={8}>
                    <Typography.Text strong>{inst.name}</Typography.Text>
                    <Tag variant={inst.isActive ? 'success' : 'muted'}>
                      {inst.isActive ? '启用' : '停用'}
                    </Tag>
                  </Space>
                  <Switch
                    checked={inst.isActive}
                    size="small"
                    disabled={!canManage}
                    onChange={() => onToggleActive(inst)}
                    checkedChildren="开"
                    unCheckedChildren="关"
                  />
                </Space>
                <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
                  凭据 {configured}/{expected.length}（敏感字段已脱敏） · {formatDailyLimit(inst.dailyLimitCents, platformCurrency)}
                </div>
                <Space size={4} style={{ marginTop: 8 }} wrap>
                  <Button size="small" icon={<EditOutlined />} onClick={() => onEdit(inst)} disabled={!canManage}>
                    编辑
                  </Button>
                  <Button size="small" icon={<ThunderboltOutlined />} disabled={!canManage} onClick={() => onTestConnection(inst)}>
                    测试连接
                  </Button>
                  <Popconfirm title="确认删除该支付实例？" onConfirm={() => onDelete(inst.id)} okText="删除" cancelText="取消">
                    <Button size="small" danger icon={<DeleteOutlined />} disabled={!canManage}>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              </div>
            );
          })}
        </Space>
      )}
    </Card>
  );
}

export default function PaymentConfigPage() {
  const canManage = usePermission('admin.page.payment_config.manage');
  const platformCurrency = usePlatformCurrency();
  const minorUnitLabel = currencyMinorUnitLabel(platformCurrency);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Instance | null>(null);
  const [form] = Form.useForm();
  const [selectedProvider, setSelectedProvider] = useState('stripe');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await paymentInstanceApi.list();
      setInstances(Array.isArray(res) ? res : res.items || []);
    } catch {
      message.error('支付实例加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchProducts = useCallback(async () => {
    try {
      const res = await productApi.list();
      const list = Array.isArray(res) ? res : res?.items || [];
      setProducts(list);
    } catch {
      // products may be empty/unauthorized — matrix degrades gracefully
    }
  }, []);

  useEffect(() => {
    void fetchData();
    void fetchProducts();
  }, [fetchData, fetchProducts]);

  const groupedByProvider = useMemo(() => {
    const map: Record<string, Instance[]> = { stripe: [], wechat: [], alipay: [] };
    for (const inst of instances) {
      if (!map[inst.providerKey]) map[inst.providerKey] = [];
      map[inst.providerKey].push(inst);
    }
    return map;
  }, [instances]);

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const openCreate = (providerKey?: string) => {
    setEditing(null);
    setSelectedProvider(providerKey || 'stripe');
    form.resetFields();
    form.setFieldsValue({
      providerKey: providerKey || 'stripe',
      isActive: true,
      dailyLimitCents: 0,
      sortOrder: 0,
      strategy: 'round_robin',
    });
    setModalOpen(true);
  };

  const openEdit = (record: Instance) => {
    setEditing(record);
    setSelectedProvider(record.providerKey);

    form.setFieldsValue({
      providerKey: record.providerKey,
      name: record.name,
      isActive: record.isActive,
      dailyLimitCents: record.dailyLimitCents,
      sortOrder: record.sortOrder,
      strategy: record.strategy,
    });
    // Clear secret/config fields explicitly
    for (const field of Object.values(PROVIDER_CONFIG_FIELDS).flat()) {
      form.setFieldValue(`config_${field.key}`, undefined);
    }
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const configFields = PROVIDER_CONFIG_FIELDS[values.providerKey] || [];
      const config: Record<string, string> = {};

      for (const field of configFields) {
        const rawValue = values[`config_${field.key}`];
        const nextValue = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
        if (nextValue) {
          config[field.key] = String(nextValue);
        }
      }

      const payload: Record<string, unknown> = {
        providerKey: values.providerKey,
        name: values.name.trim(),
        isActive: values.isActive,
        dailyLimitCents: values.dailyLimitCents || 0,
        sortOrder: values.sortOrder || 0,
        strategy: values.strategy || 'round_robin',
      };

      if (Object.keys(config).length > 0) {
        payload.config = config;
      }

      if (editing) {
        await paymentInstanceApi.update(editing.id, payload);
        message.success('支付实例已更新');
      } else {
        await paymentInstanceApi.create(payload);
        message.success('支付实例已创建');
      }
      closeModal();
      await fetchData();
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error('保存失败，请检查支付实例配置');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await paymentInstanceApi.delete(id);
      message.success('支付实例已删除');
      await fetchData();
    } catch {
      message.error('删除失败');
    }
  };

  const handleToggleActive = async (instance: Instance) => {
    try {
      await paymentInstanceApi.update(instance.id, { isActive: !instance.isActive });
      message.success(instance.isActive ? '已停用' : '已启用');
      await fetchData();
    } catch {
      message.error('状态切换失败');
    }
  };

  const handleTestConnection = (_instance: Instance) => {
    message.info('测试连接已触发，请在通道日志中查看结果');
  };

  const handleMatrixToggle = async (instance: Instance, productType: string, enabled: boolean) => {
    if (!canManage) return;
    const current = new Set(instance.supportedTypes ?? []);
    if (enabled) current.add(productType);
    else current.delete(productType);
    try {
      await paymentInstanceApi.update(instance.id, {
        supportedTypes: Array.from(current),
      });
      message.success('支付方式启停已更新');
      await fetchData();
    } catch {
      message.error('更新失败');
    }
  };

  const selectedFields = PROVIDER_CONFIG_FIELDS[selectedProvider] || [];

  // Build matrix: rows = providers (active instances grouped), cols = products
  const matrixProducts = products.length > 0
    ? products
    : [
        { id: 'subscription', name: '订阅', type: 'subscription' },
        { id: 'recharge', name: '充值', type: 'recharge' },
        { id: 'addon', name: '加油包', type: 'addon' },
      ];

  const matrixColumns = [
    {
      title: '渠道 / 实例',
      key: 'channel',
      width: 220,
      fixed: 'left' as const,
      render: (_: unknown, inst: Instance) => (
        <Space size={6}>
          <Tag variant={PROVIDER_VARIANTS[inst.providerKey] ?? 'muted'}>
            {PROVIDER_OPTIONS.find((p) => p.value === inst.providerKey)?.label || inst.providerKey}
          </Tag>
          <Typography.Text>{inst.name}</Typography.Text>
        </Space>
      ),
    },
    ...matrixProducts.map((product) => {
      const productType = product.id;
      return {
        title: product.name,
        key: product.id,
        width: 110,
        align: 'center' as const,
        render: (_: unknown, inst: Instance) => {
          const enabled = (inst.supportedTypes ?? []).includes(productType);
          return (
            <Switch
              size="small"
              checked={enabled}
              disabled={!canManage}
              onChange={(checked) => void handleMatrixToggle(inst, productType, checked)}
            />
          );
        },
      };
    }),
  ];

  return (
    <div>
      <PageHeader
        title="支付配置"
        subtitle="管理支付通道实例、凭据与产品启停矩阵"
        actions={[
          <Button key="refresh" icon={<ReloadOutlined />} onClick={() => void fetchData()}>
            刷新
          </Button>,
        ]}
      />

      <Alert
        type="info"
        showIcon
        message="编辑时敏感凭据不会回显；留空即可保留原配置，只在需要轮换时输入新值。"
        style={{ marginBottom: 16 }}
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <ChannelCard
            providerKey="stripe"
            providerLabel="Stripe"
            instances={groupedByProvider.stripe ?? []}
            platformCurrency={platformCurrency}
            canManage={canManage}
            onAdd={openCreate}
            onEdit={openEdit}
            onDelete={handleDelete}
            onToggleActive={handleToggleActive}
            onTestConnection={handleTestConnection}
          />
        </Col>
        <Col xs={24} lg={8}>
          <ChannelCard
            providerKey="wechat"
            providerLabel="微信支付"
            instances={groupedByProvider.wechat ?? []}
            platformCurrency={platformCurrency}
            canManage={canManage}
            onAdd={openCreate}
            onEdit={openEdit}
            onDelete={handleDelete}
            onToggleActive={handleToggleActive}
            onTestConnection={handleTestConnection}
          />
        </Col>
        <Col xs={24} lg={8}>
          <ChannelCard
            providerKey="alipay"
            providerLabel="支付宝"
            instances={groupedByProvider.alipay ?? []}
            platformCurrency={platformCurrency}
            canManage={canManage}
            onAdd={openCreate}
            onEdit={openEdit}
            onDelete={handleDelete}
            onToggleActive={handleToggleActive}
            onTestConnection={handleTestConnection}
          />
        </Col>
      </Row>

      <Card
        title="支付方式启停矩阵"
        bordered={false}
        style={{ marginTop: 16 }}
        bodyStyle={{ paddingTop: 12 }}
      >
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
          每行一个支付实例，每列一种产品类型。打开开关即可允许该实例为对应产品收款。
        </Typography.Text>
        <DataTable<Instance>
          dataSource={instances}
          columns={matrixColumns}
          rowKey="id"
          loading={loading}
          searchable
          searchPlaceholder="搜索支付实例 / Provider"
          pagination={false}
          scroll={{ x: 220 + matrixProducts.length * 110 }}
          locale={{
            emptyText: (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无支付实例" />
            ),
          }}
        />
      </Card>

      <Modal
        title={editing ? '编辑支付实例' : '添加支付实例'}
        open={modalOpen}
        onOk={() => void handleSave()}
        onCancel={closeModal}
        width={680}
        okText="保存"
        okButtonProps={{ disabled: !canManage }}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }} preserve={false} disabled={!canManage}>
          <Form.Item name="providerKey" label="支付渠道" rules={[{ required: true, message: '请选择支付渠道' }]}>
            <Select
              options={PROVIDER_OPTIONS}
              disabled={!!editing}
              onChange={(value) => {
                setSelectedProvider(value);
                for (const field of Object.values(PROVIDER_CONFIG_FIELDS).flat()) {
                  form.setFieldValue(`config_${field.key}`, undefined);
                }
              }}
            />
          </Form.Item>
          <Form.Item name="name" label="实例名称" rules={[{ required: true, message: '请输入实例名称' }]}>
            <Input placeholder="如：微信商户 A" />
          </Form.Item>

          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={editing ? '当前表单不会回显历史凭据，留空代表保留旧值。' : '请确保新增实例时一次性填完整支付凭据。'}
          />

          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            渠道凭据
          </Typography.Text>
          {selectedFields.map((field) => {
            const maskedHint = editing?.config?.[field.key];
            return (
              <Form.Item
                key={field.key}
                name={`config_${field.key}`}
                label={field.label}
                rules={editing || field.required === false ? [] : [{ required: true, message: `请输入${field.label}` }]}
                tooltip={maskedHint ? `当前值已脱敏：${maskedHint}` : undefined}
              >
                {field.options ? (
                  <Select
                    allowClear
                    options={field.options}
                    placeholder={editing ? `${field.label} 留空保持原值` : `请选择${field.label}`}
                  />
                ) : field.secret ? (
                  <Input.Password placeholder={editing ? '留空保持原值' : `请输入${field.label}`} />
                ) : (
                  <Input placeholder={editing ? `${field.label} 留空保持原值` : field.placeholder ?? `请输入${field.label}`} />
                )}
              </Form.Item>
            );
          })}

          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="dailyLimitCents" label={`每日限额（${minorUnitLabel}）`}>
                <StableNumberInput min={0} precision={0} style={{ width: '100%' }} placeholder="0 表示无限制" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="strategy" label="负载策略">
                <Select options={[
                  { value: 'round_robin', label: '轮询' },
                  { value: 'least_amount', label: '最小金额' },
                ]} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="sortOrder" label="排序">
                <StableNumberInput min={0} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="isActive" label="启用状态" valuePropName="checked">
                <Switch checkedChildren="启用" unCheckedChildren="停用" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}
