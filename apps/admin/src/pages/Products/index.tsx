import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card,
  Alert,
  Descriptions,
  Divider,
  Button,
  Space,
  Modal,
  Form,
  DatePicker,
  Input,
  Switch,
  Popconfirm,
  message,
  Typography,
  Tag,
  Select,
  Radio,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, AppstoreOutlined, KeyOutlined, ApiOutlined, SettingOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import {
  planApi,
  productApi,
  publisherSyncMessage,
  publisherWarningsText,
  type ProductRuntimePolicyPayload,
  type ProductRuntimePolicyResponse,
} from '../../api/admin';
import { DataTable, StableNumberInput } from '../../components/common';
import { usePermission } from '../../hooks/usePermission';
import type { ProductPaymentCallbacks } from '@ruidong/shared';
import {
  MAX_PAYMENT_CALLBACK_ORIGINS,
  normalizePaymentCallbackOrigins,
  paymentCallbackFormValues,
  paymentCallbackUpdateValue,
  type PaymentCallbackPolicyFormValues,
} from './paymentCallbackOrigins';

type BillingMode = 'SUBSCRIPTION' | 'PAY_AS_YOU_GO' | 'CODING_PLAN';
type CodingPlanFulfillmentMode = 'platform_model_package' | 'provider_resale';

const BILLING_MODE_LABEL: Record<BillingMode, string> = {
  SUBSCRIPTION: '订阅',
  PAY_AS_YOU_GO: '按量',
  CODING_PLAN: 'CodingPlan',
};

const BILLING_MODE_COLOR: Record<BillingMode, string> = {
  SUBSCRIPTION: 'blue',
  PAY_AS_YOU_GO: 'gold',
  CODING_PLAN: 'purple',
};

const CODING_PLAN_FULFILLMENT_LABEL: Record<CodingPlanFulfillmentMode, string> = {
  platform_model_package: '自营',
  provider_resale: '供应商转售',
};

const CODING_PLAN_FULFILLMENT_COLOR: Record<CodingPlanFulfillmentMode, string> = {
  platform_model_package: 'green',
  provider_resale: 'cyan',
};

interface Product {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  webhookUrl: string | null;
  allowedPaymentCallbackOrigins?: string[] | null;
  defaultPlanId: string | null;
  integrationTokenPrefix?: string | null;
  integrationTokenRotatedAt?: string | null;
  webhookSecretPrefix?: string | null;
  webhookSecretRotatedAt?: string | null;
  billingMode: BillingMode;
  codingPlanFulfillmentMode?: CodingPlanFulfillmentMode | null;
  fulfillmentMode?: CodingPlanFulfillmentMode | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
}

interface PlanOption {
  id: string;
  productId: string | null;
  name: string;
  isActive: boolean;
  monthlyPrice: number;
  monthlyCredits: number;
}

interface IntegrationStatus {
  product: Product;
  endpoints: Record<string, string>;
  paymentCallbacks: ProductPaymentCallbacks;
  credentials: {
    hasIntegrationToken: boolean;
    integrationTokenPrefix: string | null;
    integrationTokenRotatedAt: string | null;
    hasWebhookSecret: boolean;
    webhookSecretPrefix: string | null;
    webhookSecretRotatedAt: string | null;
  };
  defaultPlan: PlanOption | null;
  requirements?: {
    requiresDefaultPlan?: boolean;
    requiresWebhookUrl?: boolean;
    apiKeyDefaultBinding?: boolean;
  };
  virtualKey: { name: string; activeCount: number; totalCount: number };
  checklist: Record<string, boolean>;
}

interface IntegrationRequestContext {
  sequence: number;
  productId: string;
}

type PartnerEndpointMethod = 'BASE' | 'GET' | 'POST';

interface PartnerEndpointRow {
  key: string;
  label: string;
  method: PartnerEndpointMethod;
  value: string;
}

const PARTNER_ENDPOINT_ROWS: Array<Omit<PartnerEndpointRow, 'value'>> = [
  { key: 'base', label: 'OpenAPI Base', method: 'BASE' },
  { key: 'currentProduct', label: '当前产品', method: 'GET' },
  { key: 'catalog', label: '目录汇总', method: 'GET' },
  { key: 'products', label: '产品目录', method: 'GET' },
  { key: 'plans', label: '套餐目录', method: 'GET' },
  { key: 'bundles', label: '组合包目录', method: 'GET' },
  { key: 'boosterPacks', label: '加油包目录', method: 'GET' },
  { key: 'models', label: '模型目录', method: 'GET' },
  { key: 'modelAccess', label: '模型权限', method: 'GET' },
  { key: 'modelRoutePolicies', label: '模型路由策略', method: 'GET' },
  { key: 'modelPricing', label: '模型价格', method: 'GET' },
  { key: 'channels', label: '渠道目录', method: 'GET' },
  { key: 'provision', label: '租户开通', method: 'POST' },
  { key: 'paymentMethods', label: '支付方式', method: 'GET' },
  { key: 'paymentCreate', label: '创建支付订单', method: 'POST' },
  { key: 'paymentOrders', label: '支付订单查询', method: 'GET' },
];

const PARTNER_ENDPOINT_METHOD_COLOR: Record<PartnerEndpointMethod, string> = {
  BASE: 'default',
  GET: 'blue',
  POST: 'green',
};

const PAYMENT_CALLBACK_MODE_LABEL: Record<ProductPaymentCallbacks['mode'], string> = {
  GLOBAL_FALLBACK: '继承全局配置',
  DENY_ALL: '禁止全部回跳',
  PRODUCT_ALLOWLIST: '产品白名单',
};

const PAYMENT_CALLBACK_MODE_COLOR: Record<ProductPaymentCallbacks['mode'], string> = {
  GLOBAL_FALLBACK: 'blue',
  DENY_ALL: 'red',
  PRODUCT_ALLOWLIST: 'green',
};

function partnerEndpointRows(endpoints: Record<string, string>): PartnerEndpointRow[] {
  return PARTNER_ENDPOINT_ROWS.reduce<PartnerEndpointRow[]>((rows, item) => {
    const value = endpoints[item.key];
    if (value) {
      rows.push({ ...item, value });
    }
    return rows;
  }, []);
}

function hasRelativePartnerEndpoint(endpoints: Record<string, string>): boolean {
  return partnerEndpointRows(endpoints).some((item) => item.value.startsWith('/'));
}

const CREDENTIAL_SOURCE_LABEL: Record<ProductRuntimePolicyPayload['credentialSource'], string> = {
  keypool: '平台公共 Key 池',
  dedicated_upstream: '专属上游凭证',
};

const MODEL_SCOPE_LABEL: Record<ProductRuntimePolicyPayload['modelScopeMode'], string> = {
  plan_configured: '套餐配置',
  product_allowlist: '产品白名单',
  upstream_inherited: '上游继承',
};

const FALLBACK_POLICY_LABEL: Record<ProductRuntimePolicyPayload['fallbackPolicy'], string> = {
  none: '禁止 fallback',
  within_product: '产品内 fallback',
  within_provider: '同供应商 fallback',
  platform_default: '平台默认 fallback',
};

const RUNTIME_BILLING_MODE_LABEL: Record<ProductRuntimePolicyPayload['runtimeBillingMode'], string> = {
  payg_balance: 'PAYG 余额',
  subscription_credits: '订阅积分',
  token_plan_quota: 'TokenPlan 配额',
  included_upstream: '上游套餐内',
};

const PROVIDER_SELECTION_STRATEGY_LABEL: Record<NonNullable<ProductRuntimePolicyPayload['routeStrategy']>, string> = {
  priority: '优先级',
  weight: '权重',
  latency: '延迟优先',
  least_busy: '最少负载',
};

type ProductRuntimePolicyFormValues = Omit<ProductRuntimePolicyPayload, 'highLossBridgeExpiresAt'> & {
  highLossBridgeExpiresAt?: Dayjs | null;
};

function getErrorMessage(error: unknown, fallback: string): string {
  return (
    (error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
    (error as { message?: string })?.message ||
    fallback
  );
}

function showPublisherAwareMessage(result: unknown, successText: string) {
  const sync = publisherSyncMessage(result);
  if (sync?.ok === false) {
    message.warning(`${successText}，但 Publisher 下发未完成：${sync.error || sync.status || '未知错误'}`);
    return;
  }
  const warningText = publisherWarningsText(sync?.warnings);
  if (warningText) {
    message.warning(`${successText}，Publisher 返回警告：${warningText}`);
    return;
  }
  message.success(successText);
}

function runtimePolicyFormValues(policy: ProductRuntimePolicyResponse['policy']): ProductRuntimePolicyFormValues {
  return {
    ...policy,
    highLossBridgeExpiresAt: policy.highLossBridgeExpiresAt ? dayjs(policy.highLossBridgeExpiresAt) : null,
  };
}

export default function ProductsPage() {
  const canManage = usePermission('admin.page.products.manage');
  const canViewRoutes = usePermission('admin.page.channels.view');
  const [data, setData] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [integrationOpen, setIntegrationOpen] = useState(false);
  const [integrationLoading, setIntegrationLoading] = useState(false);
  const [integration, setIntegration] = useState<IntegrationStatus | null>(null);
  const [paymentCallbackSaving, setPaymentCallbackSaving] = useState(false);
  const integrationRequestSequenceRef = useRef(0);
  const activeIntegrationRequestRef = useRef<IntegrationRequestContext | null>(null);
  const [revealedIntegrationToken, setRevealedIntegrationToken] = useState<string | null>(null);
  const [revealedWebhookSecret, setRevealedWebhookSecret] = useState<string | null>(null);
  const [runtimePolicyOpen, setRuntimePolicyOpen] = useState(false);
  const [runtimePolicyLoading, setRuntimePolicyLoading] = useState(false);
  const [runtimePolicySaving, setRuntimePolicySaving] = useState(false);
  const [runtimePolicy, setRuntimePolicy] = useState<ProductRuntimePolicyResponse | null>(null);
  const [form] = Form.useForm();
  const [policyForm] = Form.useForm<ProductRuntimePolicyFormValues>();
  const [paymentCallbackForm] = Form.useForm<PaymentCallbackPolicyFormValues>();
  const watchedProductBillingMode = Form.useWatch('billingMode', form);
  const watchedCredentialSource = Form.useWatch('credentialSource', policyForm);
  const watchedModelScopeMode = Form.useWatch('modelScopeMode', policyForm);
  const watchedAllowHighLossBridge = Form.useWatch('allowHighLossBridgeWhenNoNative', policyForm);
  const watchedPaymentCallbackMode = Form.useWatch('paymentCallbackMode', paymentCallbackForm);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [res, planRes] = await Promise.all([
        productApi.list(),
        planApi.list(),
      ]);
      setData(res.items || res || []);
      setPlans(planRes.items || planRes || []);
    } catch {
      message.error('加载产品列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => () => {
    integrationRequestSequenceRef.current += 1;
    activeIntegrationRequestRef.current = null;
  }, []);

  const beginIntegrationRequest = (productId: string): IntegrationRequestContext => {
    const context = {
      sequence: integrationRequestSequenceRef.current + 1,
      productId,
    };
    integrationRequestSequenceRef.current = context.sequence;
    activeIntegrationRequestRef.current = context;
    return context;
  };

  const isCurrentIntegrationRequest = (context: IntegrationRequestContext): boolean => {
    const active = activeIntegrationRequestRef.current;
    return active?.sequence === context.sequence && active.productId === context.productId;
  };

  const closeIntegration = () => {
    integrationRequestSequenceRef.current += 1;
    activeIntegrationRequestRef.current = null;
    setIntegrationOpen(false);
    setIntegrationLoading(false);
    setIntegration(null);
    setPaymentCallbackSaving(false);
    setRevealedIntegrationToken(null);
    setRevealedWebhookSecret(null);
    paymentCallbackForm.resetFields();
  };

  const handleCreate = () => {
    setEditingId(null);
    form.resetFields();
    form.setFieldsValue({
      isActive: true,
      sortOrder: 0,
      billingMode: 'SUBSCRIPTION',
      codingPlanFulfillmentMode: 'platform_model_package',
    });
    setModalOpen(true);
  };

  const handleEdit = (record: Product) => {
    setEditingId(record.id);
    form.setFieldsValue({
      name: record.name,
      slug: record.slug,
      description: record.description,
      webhookUrl: record.webhookUrl,
      defaultPlanId: record.billingMode === 'SUBSCRIPTION' ? record.defaultPlanId : null,
      billingMode: record.billingMode,
      codingPlanFulfillmentMode:
        record.codingPlanFulfillmentMode ??
        record.fulfillmentMode ??
        (record.billingMode === 'CODING_PLAN' ? 'platform_model_package' : undefined),
      isActive: record.isActive,
      sortOrder: record.sortOrder,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const isCodingPlanProduct = values.billingMode === 'CODING_PLAN';
      const normalizedValues = {
        ...values,
        codingPlanFulfillmentMode:
          isCodingPlanProduct
            ? values.codingPlanFulfillmentMode ?? 'platform_model_package'
            : null,
        defaultPlanId: values.billingMode === 'SUBSCRIPTION' ? values.defaultPlanId ?? null : null,
      };
      const payload = normalizedValues;
      setSaving(true);
      if (editingId) {
        await productApi.update(editingId, payload);
        message.success('产品更新成功');
      } else {
        await productApi.create(payload);
        message.success('产品创建成功');
      }
      setModalOpen(false);
      setEditingId(null);
      form.resetFields();
      fetchData();
    } catch (error) {
      if ((error as { errorFields?: unknown[] })?.errorFields) {
        message.warning('请先修正表单中的必填项');
        return;
      }
      message.error(getErrorMessage(error, editingId ? '更新失败' : '创建失败'));
    } finally {
      setSaving(false);
    }
  };

  const openIntegration = async (record: Product) => {
    const requestContext = beginIntegrationRequest(record.id);
    setIntegrationOpen(true);
    setIntegrationLoading(true);
    setIntegration(null);
    setPaymentCallbackSaving(false);
    setRevealedIntegrationToken(null);
    setRevealedWebhookSecret(null);
    paymentCallbackForm.resetFields();
    try {
      const snapshot = await productApi.integration(record.id) as IntegrationStatus;
      if (!isCurrentIntegrationRequest(requestContext)) return;
      setIntegration(snapshot);
      paymentCallbackForm.setFieldsValue(paymentCallbackFormValues(snapshot.paymentCallbacks));
    } catch {
      if (!isCurrentIntegrationRequest(requestContext)) return;
      message.error('加载接入配置失败');
      closeIntegration();
    } finally {
      if (isCurrentIntegrationRequest(requestContext)) {
        setIntegrationLoading(false);
      }
    }
  };

  const openRuntimePolicy = async (record: Product) => {
    setRuntimePolicyOpen(true);
    setRuntimePolicyLoading(true);
    setRuntimePolicy(null);
    policyForm.resetFields();
    try {
      const snapshot = await productApi.runtimePolicy(record.id);
      setRuntimePolicy(snapshot);
      policyForm.setFieldsValue(runtimePolicyFormValues(snapshot.policy));
    } catch (error) {
      message.error(getErrorMessage(error, '加载产品策略失败'));
      setRuntimePolicyOpen(false);
    } finally {
      setRuntimePolicyLoading(false);
    }
  };

  const saveRuntimePolicy = async () => {
    if (!runtimePolicy?.product.id) return;
    try {
      const values = await policyForm.validateFields();
      const allowHighLossBridgeWhenNoNative = values.allowHighLossBridgeWhenNoNative === true;
      const payload: ProductRuntimePolicyPayload = {
        credentialSource: values.credentialSource,
        allowedProviderIds: Array.isArray(values.allowedProviderIds) ? values.allowedProviderIds : [],
        allowedChannelIds: Array.isArray(values.allowedChannelIds) ? values.allowedChannelIds : [],
        modelScopeMode: values.modelScopeMode,
        allowedModels: values.modelScopeMode === 'product_allowlist' && Array.isArray(values.allowedModels)
          ? values.allowedModels
          : [],
        fallbackPolicy: values.fallbackPolicy,
        runtimeBillingMode: values.runtimeBillingMode,
        routeStrategy: values.routeStrategy || null,
        allowHighLossBridgeWhenNoNative,
        allowBridgeOnNativeFailure: values.allowBridgeOnNativeFailure === true,
        highLossBridgeReason: allowHighLossBridgeWhenNoNative ? values.highLossBridgeReason : null,
        highLossBridgeOwner: allowHighLossBridgeWhenNoNative ? values.highLossBridgeOwner : null,
        highLossBridgeExpiresAt:
          allowHighLossBridgeWhenNoNative && values.highLossBridgeExpiresAt
            ? values.highLossBridgeExpiresAt.toISOString()
            : null,
        highLossBridgeApproval: allowHighLossBridgeWhenNoNative ? values.highLossBridgeApproval : null,
        status: values.status,
      };
      setRuntimePolicySaving(true);
      const updated = await productApi.updateRuntimePolicy(runtimePolicy.product.id, payload);
      setRuntimePolicy(updated);
      policyForm.setFieldsValue(runtimePolicyFormValues(updated.policy));
      showPublisherAwareMessage(updated, '产品运行策略已保存');
    } catch (error) {
      if ((error as { errorFields?: unknown[] })?.errorFields) {
        message.warning('请先修正策略配置');
        return;
      }
      message.error(getErrorMessage(error, '保存产品策略失败'));
    } finally {
      setRuntimePolicySaving(false);
    }
  };

  const refreshIntegration = async (
    requestContext: IntegrationRequestContext,
    refreshPaymentCallbackForm = false,
  ): Promise<IntegrationStatus | null> => {
    if (!isCurrentIntegrationRequest(requestContext)) return null;
    const snapshot = await productApi.integration(requestContext.productId) as IntegrationStatus;
    if (!isCurrentIntegrationRequest(requestContext)) return null;
    setIntegration(snapshot);
    if (refreshPaymentCallbackForm) {
      paymentCallbackForm.setFieldsValue(paymentCallbackFormValues(snapshot.paymentCallbacks));
    }
    return snapshot;
  };

  const savePaymentCallbackPolicy = async () => {
    const requestContext = activeIntegrationRequestRef.current;
    if (
      !requestContext ||
      !integration?.product.id ||
      integration.product.id !== requestContext.productId ||
      !isCurrentIntegrationRequest(requestContext)
    ) return;
    try {
      const values = await paymentCallbackForm.validateFields();
      const allowedPaymentCallbackOrigins = paymentCallbackUpdateValue(values);
      if (!isCurrentIntegrationRequest(requestContext)) return;
      setPaymentCallbackSaving(true);
      await productApi.update(requestContext.productId, { allowedPaymentCallbackOrigins });
      try {
        const refreshed = await refreshIntegration(requestContext, true);
        if (refreshed && isCurrentIntegrationRequest(requestContext)) {
          message.success('支付回跳策略已保存并生效');
        }
      } catch {
        if (isCurrentIntegrationRequest(requestContext)) {
          message.warning('支付回跳策略已保存，但状态刷新失败，请关闭后重新打开接入配置');
        }
      }
    } catch (error) {
      if (!isCurrentIntegrationRequest(requestContext)) return;
      if ((error as { errorFields?: unknown[] })?.errorFields) {
        message.warning('请先修正支付回跳配置');
        return;
      }
      message.error(getErrorMessage(error, '保存支付回跳策略失败'));
    } finally {
      if (isCurrentIntegrationRequest(requestContext)) {
        setPaymentCallbackSaving(false);
      }
    }
  };

  const rotateIntegrationToken = async () => {
    const requestContext = activeIntegrationRequestRef.current;
    if (!requestContext || integration?.product.id !== requestContext.productId) return;
    const data = await productApi.rotateIntegrationToken(requestContext.productId);
    if (!isCurrentIntegrationRequest(requestContext)) return;
    setRevealedIntegrationToken(data.token);
    await refreshIntegration(requestContext);
    if (isCurrentIntegrationRequest(requestContext)) {
      message.success('产品接入令牌已生成');
    }
  };

  const rotateWebhookSecret = async () => {
    const requestContext = activeIntegrationRequestRef.current;
    if (!requestContext || integration?.product.id !== requestContext.productId) return;
    const data = await productApi.rotateWebhookSecret(requestContext.productId);
    if (!isCurrentIntegrationRequest(requestContext)) return;
    setRevealedWebhookSecret(data.secret);
    await refreshIntegration(requestContext);
    if (isCurrentIntegrationRequest(requestContext)) {
      message.success('Webhook Secret 已生成');
    }
  };

  const handleToggleActive = async (record: Product, checked: boolean) => {
    try {
      await productApi.update(record.id, { isActive: checked });
      message.success(checked ? '已启用' : '已停用');
      fetchData();
    } catch {
      message.error('操作失败');
    }
  };

  const handleDelete = async (record: Product) => {
    try {
      await productApi.delete(record.id);
      message.success('产品删除成功');
      fetchData();
    } catch (error) {
      message.error(getErrorMessage(error, '删除失败'));
    }
  };

  const runtimePolicyChannelOptions = (runtimePolicy?.channels || []).map((channel) => ({
    value: channel.id,
    label: `${channel.name} · ${channel.provider} · ${channel.runtimeProviderId}`,
  }));

  const runtimePolicyModelOptions = Array.from(new Set(
    (runtimePolicy?.channels || []).flatMap((channel) => channel.models || []),
  )).sort().map((model) => ({ value: model, label: model }));

  const columns = [
    {
      title: '产品名称',
      dataIndex: 'name',
      key: 'name',
      width: 180,
      render: (name: string) => <span style={{ fontWeight: 500 }}>{name}</span>,
    },
    {
      title: 'Slug',
      dataIndex: 'slug',
      key: 'slug',
      width: 150,
      render: (slug: string) => <Typography.Text code>{slug}</Typography.Text>,
    },
    {
      title: '计费模式',
      dataIndex: 'billingMode',
      key: 'billingMode',
      width: 180,
      render: (mode: BillingMode, record: Product) => {
        const fulfillmentMode = record.codingPlanFulfillmentMode ?? record.fulfillmentMode ?? null;
        return (
          <Space size={4} wrap>
            <Tag color={BILLING_MODE_COLOR[mode] || 'default'}>{BILLING_MODE_LABEL[mode] || mode}</Tag>
            {mode === 'CODING_PLAN' && fulfillmentMode ? (
              <Tag color={CODING_PLAN_FULFILLMENT_COLOR[fulfillmentMode] || 'default'}>
                {CODING_PLAN_FULFILLMENT_LABEL[fulfillmentMode] || fulfillmentMode}
              </Tag>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (desc: string | null) => desc || <Typography.Text type="secondary">-</Typography.Text>,
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 100,
      render: (active: boolean, record: Product) => (
        <Switch
          size="small"
          checked={active}
          onChange={(checked) => handleToggleActive(record, checked)}
          checkedChildren="启用"
          unCheckedChildren="停用"
          disabled={!canManage}
        />
      ),
    },
    {
      title: '排序',
      dataIndex: 'sortOrder',
      key: 'sortOrder',
      width: 80,
    },
    {
      title: '操作',
      key: 'actions',
      width: 280,
      render: (_: unknown, record: Product) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            icon={<ApiOutlined />}
            onClick={() => openIntegration(record)}
            disabled={!canManage}
          >
            接入
          </Button>
          <Button
            type="link"
            size="small"
            icon={<SettingOutlined />}
            onClick={() => window.location.assign('/channels')}
            disabled={!canViewRoutes}
          >
            渠道配置
          </Button>
          <Button
            type="link"
            size="small"
            icon={<SettingOutlined />}
            onClick={() => openRuntimePolicy(record)}
            disabled={!canManage}
          >
            策略
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
            disabled={!canManage}
          >
            编辑
          </Button>
          <Popconfirm
            title={`确定删除产品「${record.name}」？`}
            description="已有套餐、加油包或订阅引用时会被拒绝删除。"
            okText="删除"
            cancelText="取消"
            onConfirm={() => handleDelete(record)}
          >
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
        </Space>
      ),
    },
  ];

  return (
    <div>
      <h2 style={{ marginBottom: 24, fontSize: 20, fontWeight: 600 }}>
        <AppstoreOutlined /> 产品管理
      </h2>

      <Card bordered={false}>
        <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
          <Typography.Text type="secondary">
            管理系统中的产品边界。产品只区分计费/履约模式；具体套餐 SKU 在对应套餐页面维护。
          </Typography.Text>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate} disabled={!canManage}>
            新增产品
          </Button>
        </Space>

        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="渠道投放、渠道组和适用对象规则已统一到渠道管理配置"
          description="产品页只维护产品基础信息、计费模式和 SaaS 接入配置；Publisher runtime 下发仍由 Billing 根据产品渠道 route graph 生成。"
        />

        <DataTable
          dataSource={data}
          columns={columns}
          rowKey="id"
          loading={loading}
          searchable
          searchPlaceholder="搜索产品名称 / Slug"
          pagination={false}
          scroll={{ x: 1000 }}
          size="middle"
        />

        {data.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Tag>共 {data.length} 个产品</Tag>
            <Tag color="green">{data.filter((r) => r.isActive).length} 个启用</Tag>
            <Tag color="default">{data.filter((r) => !r.isActive).length} 个停用</Tag>
          </div>
        )}
      </Card>

      <Modal
        title={editingId ? '编辑产品' : '新增产品'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => { setModalOpen(false); setEditingId(null); }}
        okText={editingId ? '保存' : '创建'}
        cancelText="取消"
        confirmLoading={saving}
        okButtonProps={{ disabled: !canManage }}
        width={520}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }} disabled={!canManage}>
          <Form.Item
            name="name"
            label="产品名称"
            rules={[{ required: true, message: '请输入产品名称' }]}
          >
            <Input placeholder="例如：RDClaw" />
          </Form.Item>
          <Form.Item
            name="slug"
            label="Slug"
            rules={[{ required: true, message: '请输入 Slug' }]}
          >
            <Input placeholder="例如：rdclaw" disabled={!!editingId} />
          </Form.Item>
          <Form.Item
            name="billingMode"
            label="计费模式"
            rules={[{ required: true, message: '请选择计费模式' }]}
            extra="决定产品的计费与运行时边界；具体套餐 SKU 不在产品里配置。"
          >
            <Select
              options={[
                { value: 'SUBSCRIPTION', label: '订阅 (月费 + 月度积分)' },
                { value: 'PAY_AS_YOU_GO', label: '按量付费 (预付余额)' },
                { value: 'CODING_PLAN', label: 'CodingPlan (运行时产品)' },
              ]}
              onChange={(value) => {
                if (value === 'CODING_PLAN' && !form.getFieldValue('codingPlanFulfillmentMode')) {
                  form.setFieldValue('codingPlanFulfillmentMode', 'platform_model_package');
                }
                if (value === 'CODING_PLAN') {
                  form.setFieldValue('defaultPlanId', null);
                }
                if (value !== 'CODING_PLAN') {
                  form.setFieldValue('codingPlanFulfillmentMode', null);
                }
              }}
              disabled={!!editingId}
            />
          </Form.Item>
          {watchedProductBillingMode === 'CODING_PLAN' && (
            <Form.Item
              name="codingPlanFulfillmentMode"
              label="CodingPlan 履约模式"
              initialValue="platform_model_package"
              rules={[{ required: true, message: '请选择 CodingPlan 履约模式' }]}
              extra="产品层只做自营/供应商转售分类；本地售卖 SKU、价格和上游绑定在自营套餐或三方套餐页面维护。"
            >
              <Select
                options={[
                  { value: 'platform_model_package', label: '自营模式' },
                  { value: 'provider_resale', label: '供应商转售模式' },
                ]}
              />
            </Form.Item>
          )}
          {editingId && watchedProductBillingMode === 'SUBSCRIPTION' && (
            <Form.Item name="defaultPlanId" label="SaaS 默认套餐">
              <Select
                allowClear
                placeholder="选择自动开通套餐"
                options={plans
                  .filter((plan) => plan.productId === editingId)
                  .map((plan) => ({
                    value: plan.id,
                    label: `${plan.name} (${plan.id})`,
                  }))}
              />
            </Form.Item>
          )}
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} placeholder="产品描述（可选）" />
          </Form.Item>
          <Form.Item name="webhookUrl" label="Webhook URL" extra="SaaS 后端同步回调地址，套餐/模型权限变更时自动推送">
            <Input placeholder="例如：https://your-saas-domain.com/api/mgmt/sync/webhook" />
          </Form.Item>
          <Space size={16}>
            <Form.Item name="sortOrder" label="排序" initialValue={0}>
              <StableNumberInput min={0} precision={0} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="isActive" label="状态" valuePropName="checked" initialValue={true}>
              <Switch checkedChildren="启用" unCheckedChildren="停用" />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      <Modal
        title={runtimePolicy?.product.name ? `${runtimePolicy.product.name} 运行策略` : '产品运行策略'}
        open={runtimePolicyOpen}
        onCancel={() => setRuntimePolicyOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setRuntimePolicyOpen(false)}>
            取消
          </Button>,
          <Button
            key="save"
            type="primary"
            icon={<SettingOutlined />}
            onClick={saveRuntimePolicy}
            loading={runtimePolicySaving}
            disabled={!canManage || runtimePolicyLoading || !runtimePolicy}
          >
            保存策略
          </Button>,
        ]}
        width={920}
        destroyOnClose
      >
        {runtimePolicyLoading || !runtimePolicy ? (
          <div style={{ padding: 24 }}>加载中...</div>
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Alert
              type={runtimePolicy.explicit ? 'success' : 'info'}
              showIcon
              message={runtimePolicy.explicit ? `已保存策略 · revision ${runtimePolicy.policy.revision}` : '当前使用默认推导策略'}
              description="产品运行策略决定该产品进入 gateway 后可使用哪些渠道、凭证来源、模型范围和 fallback 边界；SaaS 接入令牌仍在“接入配置”里管理。"
            />

            <Descriptions bordered size="small" column={3}>
              <Descriptions.Item label="Product ID">
                <Typography.Text copyable code>{runtimePolicy.product.id}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="Product Slug">
                <Typography.Text copyable code>{runtimePolicy.product.slug}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="计费模式">
                <Tag color={BILLING_MODE_COLOR[runtimePolicy.product.billingMode as BillingMode] || 'default'}>
                  {BILLING_MODE_LABEL[runtimePolicy.product.billingMode as BillingMode] || runtimePolicy.product.billingMode}
                </Tag>
              </Descriptions.Item>
            </Descriptions>

            <Form form={policyForm} layout="vertical" disabled={!canManage}>
              <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>
                凭证与计费语义
              </Typography.Title>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
                <Form.Item
                  name="status"
                  label="策略状态"
                  rules={[{ required: true, message: '请选择策略状态' }]}
                >
                  <Select
                    options={[
                      { value: 'active', label: '启用' },
                      { value: 'disabled', label: '停用' },
                    ]}
                  />
                </Form.Item>
                <Form.Item
                  name="credentialSource"
                  label="凭证来源"
                  rules={[{ required: true, message: '请选择凭证来源' }]}
                >
                  <Select
                    options={Object.entries(CREDENTIAL_SOURCE_LABEL).map(([value, label]) => ({ value, label }))}
                  />
                </Form.Item>
                <Form.Item
                  name="runtimeBillingMode"
                  label="运行计费语义"
                  rules={[{ required: true, message: '请选择运行计费语义' }]}
                >
                  <Select
                    options={Object.entries(RUNTIME_BILLING_MODE_LABEL).map(([value, label]) => ({ value, label }))}
                  />
                </Form.Item>
                <Form.Item
                  name="fallbackPolicy"
                  label="Fallback 边界"
                  rules={[{ required: true, message: '请选择 fallback 边界' }]}
                >
                  <Select
                    options={Object.entries(FALLBACK_POLICY_LABEL).map(([value, label]) => ({ value, label }))}
                  />
                </Form.Item>
                <Form.Item
                  name="routeStrategy"
                  label="Provider 选择策略"
                  extra="这是产品级默认 provider selection，不是渠道组 route graph 的 failover 策略。"
                >
                  <Select
                    allowClear
                    placeholder="继承平台默认 provider strategy"
                    options={Object.entries(PROVIDER_SELECTION_STRATEGY_LABEL).map(([value, label]) => ({ value, label }))}
                  />
                </Form.Item>
                </div>

                <Divider style={{ margin: '8px 0 16px' }} />
                <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>
                  桥接治理
                </Typography.Title>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
                  <Form.Item
                    name="allowBridgeOnNativeFailure"
                    label="原生失败后桥接"
                    valuePropName="checked"
                    extra="原生端点请求失败后，允许 gateway 尝试可接受的桥接路径。"
                  >
                    <Switch />
                  </Form.Item>
                  <Form.Item
                    name="allowHighLossBridgeWhenNoNative"
                    label="无原生端点高损桥接"
                    valuePropName="checked"
                    extra="明知可能丢 thinking 仍放行；开启后必须填写治理字段。"
                  >
                    <Switch />
                  </Form.Item>
                </div>
                {watchedAllowHighLossBridge && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
                    <Form.Item
                      name="highLossBridgeReason"
                      label="高损桥接原因"
                      rules={[{ required: true, whitespace: true, message: '请填写高损桥接原因' }]}
                    >
                      <Input.TextArea rows={3} maxLength={512} showCount />
                    </Form.Item>
                    <Form.Item
                      name="highLossBridgeApproval"
                      label="审批记录"
                      rules={[{ required: true, whitespace: true, message: '请填写审批记录' }]}
                    >
                      <Input.TextArea rows={3} maxLength={512} showCount />
                    </Form.Item>
                    <Form.Item
                      name="highLossBridgeOwner"
                      label="Owner"
                      rules={[{ required: true, whitespace: true, message: '请填写 owner' }]}
                    >
                      <Input maxLength={128} />
                    </Form.Item>
                    <Form.Item
                      name="highLossBridgeExpiresAt"
                      label="过期时间"
                      rules={[
                        { required: true, message: '请选择过期时间' },
                        {
                          validator(_, value: Dayjs | null | undefined) {
                            if (!value || value.isAfter(dayjs())) return Promise.resolve();
                            return Promise.reject(new Error('过期时间必须晚于当前时间'));
                          },
                        },
                      ]}
                    >
                      <DatePicker
                        showTime
                        style={{ width: '100%' }}
                        disabledDate={(current) => Boolean(current && current.endOf('day').isBefore(dayjs()))}
                      />
                    </Form.Item>
                  </div>
                )}

              {watchedCredentialSource === 'dedicated_upstream' && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message="专属上游凭证不会使用平台公共 Key 池"
                  description="该模式要求订单/订阅激活后存在对应专属上游 Key；fallback 只能限制在禁用或同供应商范围内。"
                />
              )}

              <Divider style={{ margin: '8px 0 16px' }} />
              <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>
                渠道边界
              </Typography.Title>
              <Form.Item
                name="allowedChannelIds"
                label="允许渠道"
                extra="选择渠道后保存时会自动推导 runtime provider id；留空表示不在产品层限制具体渠道。"
              >
                <Select
                  mode="multiple"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="选择该产品可用的渠道"
                  options={runtimePolicyChannelOptions}
                />
              </Form.Item>
              <Form.Item
                name="allowedProviderIds"
                label="允许 Runtime Provider ID"
                extra="通常由产品渠道自动推导；需要跨渠道合并时可手动追加。"
              >
                <Select mode="tags" tokenSeparators={[',', ' ']} placeholder="例如 pc_product-channel-id" />
              </Form.Item>

              <Divider style={{ margin: '8px 0 16px' }} />
              <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>
                模型范围
              </Typography.Title>
              <Form.Item
                name="modelScopeMode"
                label="模型范围模式"
                rules={[{ required: true, message: '请选择模型范围模式' }]}
              >
                <Select
                  options={Object.entries(MODEL_SCOPE_LABEL).map(([value, label]) => ({ value, label }))}
                />
              </Form.Item>
              {watchedModelScopeMode === 'upstream_inherited' && (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message="上游继承模式不在 stsoft 本地重复配置模型和配额"
                  description="供应商转售套餐应由上游产品目录决定可用模型、Token 额度、周期和限制。"
                />
              )}
              <Form.Item
                name="allowedModels"
                label="产品模型白名单"
                extra="仅在“产品白名单”模式生效；套餐配置和上游继承模式会在保存时清空该字段。"
                rules={[
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (getFieldValue('modelScopeMode') !== 'product_allowlist') return Promise.resolve();
                      return Array.isArray(value) && value.length > 0
                        ? Promise.resolve()
                        : Promise.reject(new Error('产品白名单模式必须至少配置一个模型'));
                    },
                  }),
                ]}
              >
                <Select
                  mode="tags"
                  allowClear
                  disabled={watchedModelScopeMode !== 'product_allowlist'}
                  tokenSeparators={[',', ' ']}
                  placeholder="选择或输入模型名"
                  options={runtimePolicyModelOptions}
                />
              </Form.Item>
            </Form>
          </Space>
        )}
      </Modal>

      <Modal
        title={integration?.product.name ? `${integration.product.name} 接入配置` : '产品接入配置'}
        open={integrationOpen}
        onCancel={closeIntegration}
        footer={null}
        width={880}
        destroyOnClose
      >
        {integrationLoading || !integration ? (
          <div style={{ padding: 24 }}>加载中...</div>
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Alert
              type="info"
              showIcon
              message="外部 SaaS 统一通过 Partner OpenAPI 接入"
              description="接入方只使用下方 Partner OpenAPI 地址和产品接入令牌。Billing 内部接口、集群内服务名和旧同步接口不再作为外部接入契约。"
            />
            {hasRelativePartnerEndpoint(integration.endpoints) && (
              <Alert
                type="warning"
                showIcon
                message="OpenAPI 对外 Base URL 未配置"
                description="当前展示的是相对路径，外部产品不能直接调用。需要在 billing OpenAPI 服务配置 PARTNER_API_PUBLIC_BASE_URL 或 OPENAPI_PUBLIC_BASE_URL 后再提供给接入方。"
              />
            )}

            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="Product ID">
                <Typography.Text copyable code>{integration.product.id}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="Product Slug">
                <Typography.Text copyable code>{integration.product.slug}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="虚拟 Key">
                {integration.virtualKey.name} · active {integration.virtualKey.activeCount} / total {integration.virtualKey.totalCount}
              </Descriptions.Item>
              <Descriptions.Item label="默认套餐">
                {integration.requirements?.requiresDefaultPlan === false
                  ? <Typography.Text type="secondary">不适用</Typography.Text>
                  : integration.defaultPlan
                  ? `${integration.defaultPlan.name} (${integration.defaultPlan.id})`
                  : <Typography.Text type="danger">未配置</Typography.Text>}
              </Descriptions.Item>
              <Descriptions.Item label="支付回跳">
                {integration.checklist.hasPaymentCallbackOrigins
                  ? <Tag color="green">产品白名单已配置</Tag>
                  : integration.paymentCallbacks.mode === 'DENY_ALL'
                    ? <Tag color="red">已明确禁用</Tag>
                    : <Tag color="gold">未配置产品白名单</Tag>}
              </Descriptions.Item>
              {integration.requirements?.apiKeyDefaultBinding && (
                <Descriptions.Item label="API Key 默认绑定">
                  <Tag color="gold">PAY_AS_YOU_GO</Tag>
                  <Typography.Text type="secondary"> 用户未指定产品时绑定到该产品</Typography.Text>
                </Descriptions.Item>
              )}
            </Descriptions>

            <DataTable
              size="small"
              pagination={false}
              rowKey="key"
              dataSource={partnerEndpointRows(integration.endpoints)}
              columns={[
                {
                  title: '方法',
                  dataIndex: 'method',
                  width: 88,
                  render: (method: PartnerEndpointMethod) => (
                    <Tag color={PARTNER_ENDPOINT_METHOD_COLOR[method]}>{method}</Tag>
                  ),
                },
                { title: '用途', dataIndex: 'label', width: 140 },
                {
                  title: 'Partner OpenAPI Endpoint',
                  dataIndex: 'value',
                  render: (value: string) => (
                    <Typography.Text copyable code style={{ whiteSpace: 'normal', wordBreak: 'break-all' }}>
                      {value}
                    </Typography.Text>
                  ),
                },
              ]}
            />

            {integration.requirements?.requiresDefaultPlan !== false && !integration.checklist.hasDefaultPlan && (
              <Alert type="warning" showIcon message="该产品没有可用于 SaaS 自动开通的默认套餐" />
            )}

            <Divider style={{ margin: 0 }} />

            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Space align="start" style={{ justifyContent: 'space-between', width: '100%' }}>
                <div>
                  <Typography.Text strong>支付回跳策略</Typography.Text>
                  <Typography.Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
                    successUrl / cancelUrl 是支付完成后浏览器返回产品页面的地址；Webhook 是 Billing 后端通知产品后端的地址，两者相互独立。
                  </Typography.Paragraph>
                </div>
                <Tag color={PAYMENT_CALLBACK_MODE_COLOR[integration.paymentCallbacks.mode]}>
                  当前生效 · {PAYMENT_CALLBACK_MODE_LABEL[integration.paymentCallbacks.mode]}
                </Tag>
              </Space>

              {integration.paymentCallbacks.mode === 'GLOBAL_FALLBACK' && (
                <Alert
                  type="warning"
                  showIcon
                  message="外部浏览器支付尚未配置产品专属白名单"
                  description="当前继承 Billing 全局配置，仅用于兼容历史或内部产品。外部产品上线前应切换为产品白名单，避免依赖部署环境变量。"
                />
              )}
              {integration.paymentCallbacks.mode === 'DENY_ALL' && (
                <Alert
                  type="warning"
                  showIcon
                  message="外部浏览器支付已明确禁用"
                  description="当前策略会拒绝该产品的所有 successUrl / cancelUrl；如需启用浏览器支付，请切换为产品白名单并配置允许的 Origin。"
                />
              )}

              <Form<PaymentCallbackPolicyFormValues>
                form={paymentCallbackForm}
                layout="vertical"
                requiredMark={false}
              >
                <Form.Item name="paymentCallbackMode" label="策略模式">
                  <Radio.Group disabled={!canManage}>
                    <Space direction="vertical" size={8}>
                      <Radio value="GLOBAL_FALLBACK">
                        <Typography.Text strong>继承全局配置</Typography.Text>
                        <Typography.Text type="secondary"> · 仅用于兼容历史或内部产品</Typography.Text>
                      </Radio>
                      <Radio value="PRODUCT_ALLOWLIST">
                        <Typography.Text strong>产品白名单</Typography.Text>
                        <Typography.Text type="secondary"> · 仅允许该产品配置的 Origin</Typography.Text>
                      </Radio>
                      <Radio value="DENY_ALL">
                        <Typography.Text strong>禁止全部回跳</Typography.Text>
                        <Typography.Text type="secondary"> · 拒绝所有 successUrl / cancelUrl</Typography.Text>
                      </Radio>
                    </Space>
                  </Radio.Group>
                </Form.Item>

                {watchedPaymentCallbackMode === 'PRODUCT_ALLOWLIST' && (
                  <Form.Item
                    name="allowedPaymentCallbackOrigins"
                    label={`允许的 Origin（最多 ${MAX_PAYMENT_CALLBACK_ORIGINS} 个）`}
                    extra="只填写协议、域名和端口，不包含业务路径、参数、锚点或通配符。生产域名必须使用 HTTPS；HTTP 仅允许 localhost、127.0.0.1 和 [::1]。"
                    validateTrigger={['onChange', 'onBlur']}
                    rules={[
                      {
                        validator: async (_, value: unknown) => {
                          try {
                            const origins = normalizePaymentCallbackOrigins(Array.isArray(value) ? value : []);
                            if (origins.length === 0) {
                              throw new Error('产品白名单模式至少需要配置一个回跳 Origin');
                            }
                          } catch (error) {
                            throw new Error(getErrorMessage(error, '回跳 Origin 配置不合法'));
                          }
                        },
                      },
                    ]}
                  >
                    <Select
                      mode="tags"
                      allowClear
                      disabled={!canManage}
                      maxCount={MAX_PAYMENT_CALLBACK_ORIGINS}
                      maxTagCount="responsive"
                      tokenSeparators={[',', '\n']}
                      placeholder="例如 https://app.example.com"
                      notFoundContent={null}
                    />
                  </Form.Item>
                )}

                <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
                  <Button
                    type="primary"
                    disabled={!canManage}
                    loading={paymentCallbackSaving}
                    onClick={savePaymentCallbackPolicy}
                  >
                    保存支付回跳策略
                  </Button>
                </Space>
              </Form>

              <Alert
                type={integration.paymentCallbacks.mode === 'DENY_ALL' ? 'warning' : 'info'}
                showIcon
                message={`当前有效 Origin（${integration.paymentCallbacks.effectiveOrigins.length}）`}
                description={integration.paymentCallbacks.effectiveOrigins.length > 0 ? (
                  <Space direction="vertical" size={4} style={{ width: '100%', maxHeight: 144, overflowY: 'auto' }}>
                    {integration.paymentCallbacks.effectiveOrigins.map((origin) => (
                      <Typography.Text key={origin} copyable code style={{ wordBreak: 'break-all' }}>
                        {origin}
                      </Typography.Text>
                    ))}
                  </Space>
                ) : (
                  <Typography.Text type="secondary">当前没有允许的支付回跳 Origin。</Typography.Text>
                )}
              />
            </Space>

            <Divider style={{ margin: 0 }} />

            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                <Typography.Text strong><KeyOutlined /> 产品接入令牌</Typography.Text>
                <Button disabled={!canManage} onClick={rotateIntegrationToken}>生成/轮换</Button>
              </Space>
              <Typography.Text type="secondary">
                {integration.credentials.hasIntegrationToken
                  ? `当前前缀 ${integration.credentials.integrationTokenPrefix || '-'}`
                  : '尚未生成'}
              </Typography.Text>
              {revealedIntegrationToken && (
                <Alert
                  type="success"
                  showIcon
                  message="仅显示一次"
                  description={<Typography.Paragraph copyable code>{revealedIntegrationToken}</Typography.Paragraph>}
                />
              )}
            </Space>

            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                <Typography.Text strong><KeyOutlined /> Webhook Secret</Typography.Text>
                <Button disabled={!canManage} onClick={rotateWebhookSecret}>生成/轮换</Button>
              </Space>
              <Typography.Text type="secondary">
                {integration.credentials.hasWebhookSecret
                  ? `当前前缀 ${integration.credentials.webhookSecretPrefix || '-'}`
                  : '未配置时使用全局 webhook secret'}
              </Typography.Text>
              {revealedWebhookSecret && (
                <Alert
                  type="success"
                  showIcon
                  message="仅显示一次"
                  description={<Typography.Paragraph copyable code>{revealedWebhookSecret}</Typography.Paragraph>}
                />
              )}
            </Space>
          </Space>
        )}
      </Modal>
    </div>
  );
}
