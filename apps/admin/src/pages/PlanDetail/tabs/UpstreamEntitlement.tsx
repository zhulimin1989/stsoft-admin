import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Descriptions, Form, Select, Space, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { CodingPlanUpstreamProduct } from '../../../api/admin';
import type { PlanDetailChange, PlanDetailState } from '../types';

interface Props {
  plan: PlanDetailState;
  onChange: PlanDetailChange;
  upstreamProducts: CodingPlanUpstreamProduct[];
  loadingProducts?: boolean;
  onRefresh?: () => void | Promise<void>;
  canManage?: boolean;
}

const { Text } = Typography;

function formatPrice(value: CodingPlanUpstreamProduct['salePrice']): string {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

function formatLimit(value: number | null): string {
  return value == null ? '-' : value.toLocaleString('zh-CN');
}

function productOptionLabel(product: CodingPlanUpstreamProduct): string {
  const parts = [
    product.productName,
    product.productCycle,
    product.salePrice == null ? null : `价格 ${formatPrice(product.salePrice)}`,
    product.upstreamProductId,
  ].filter(Boolean);
  return parts.join(' · ');
}

function providerLineLabel(product: CodingPlanUpstreamProduct): string {
  return product.providerLineCode
    ? `${product.providerLineCode} (${product.providerLineId})`
    : product.providerLineId ?? '未绑定线路';
}

export function UpstreamEntitlementTab({
  plan,
  onChange,
  upstreamProducts,
  loadingProducts = false,
  onRefresh,
  canManage = true,
}: Props) {
  const navigate = useNavigate();
  const [form] = Form.useForm<PlanDetailState>();

  const providerLineOptions = useMemo(() => {
    const map = new Map<string, { value: string; label: string }>();
    for (const product of upstreamProducts) {
      if (!product.providerLineId || map.has(product.providerLineId)) continue;
      map.set(product.providerLineId, {
        value: product.providerLineId,
        label: providerLineLabel(product),
      });
    }
    if (plan.providerLineId && !map.has(plan.providerLineId)) {
      map.set(plan.providerLineId, {
        value: plan.providerLineId,
        label: plan.providerLineCode
          ? `${plan.providerLineCode} (${plan.providerLineId})`
          : `${plan.providerLineId} (目录未同步)`,
      });
    }
    return [...map.values()];
  }, [plan.providerLineCode, plan.providerLineId, upstreamProducts]);

  const lineProducts = useMemo(
    () => upstreamProducts.filter((product) => product.providerLineId === plan.providerLineId),
    [plan.providerLineId, upstreamProducts],
  );
  const selectedProduct = lineProducts.find((product) => product.upstreamProductId === plan.upstreamProductId) ?? null;
  const productOptions = useMemo(() => {
    const options = lineProducts.map((product) => ({
      label: productOptionLabel(product),
      value: product.upstreamProductId,
    }));
    if (
      plan.upstreamProductId
      && !options.some((option) => option.value === plan.upstreamProductId)
    ) {
      options.unshift({
        label: `当前绑定: ${plan.upstreamProductId} (目录未同步)`,
        value: plan.upstreamProductId,
      });
    }
    return options;
  }, [lineProducts, plan.upstreamProductId]);

  useEffect(() => {
    form.setFieldsValue({
      providerLineId: plan.providerLineId,
      upstreamProductId: plan.upstreamProductId,
    });
  }, [form, plan.providerLineId, plan.upstreamProductId]);

  const handleValuesChange = (
    changed: Partial<PlanDetailState>,
    values: PlanDetailState,
  ) => {
    const providerLineId = values.providerLineId?.trim() || null;
    const providerLineCode = upstreamProducts.find((product) => product.providerLineId === providerLineId)
      ?.providerLineCode ?? null;
    const upstreamProductId = 'providerLineId' in changed
      ? null
      : values.upstreamProductId?.trim() || null;
    const next: PlanDetailState = {
      ...plan,
      providerLineId,
      providerLineCode,
      upstreamProductId,
    };

    form.setFieldsValue({
      providerLineId,
      upstreamProductId,
    });
    onChange(next);
  };

  return (
    <div style={{ maxWidth: 980 }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 18 }}
        message="上游权益由供应商产品继承"
        description="供应商转售套餐只绑定一个供应商线路和一个已同步的上游产品；可用模型、Token 额度、套餐周期和上游限制来自供应商产品，不在 Raytone 本地重复配置。"
      />

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          providerLineId: plan.providerLineId,
          upstreamProductId: plan.upstreamProductId,
        }}
        disabled={!canManage}
        onValuesChange={handleValuesChange}
      >
        <Space size={18} align="start" wrap style={{ width: '100%' }}>
          <Form.Item
            label="供应商线路"
            name="providerLineId"
            rules={[{ required: true, message: '请选择供应商线路' }]}
            style={{ minWidth: 300, flex: '0 0 300px' }}
          >
            <Select
              showSearch
              allowClear
              placeholder="选择已同步目录的供应商线路"
              optionFilterProp="label"
              options={providerLineOptions}
            />
          </Form.Item>
          <Form.Item
            label="上游产品"
            name="upstreamProductId"
            rules={[{ required: true, message: '请选择上游产品' }]}
            tooltip="来自转售配置页同步的产品目录；不会手填 productId。"
            style={{ minWidth: 520, flex: '1 1 520px' }}
          >
            <Select
              showSearch
              allowClear
              loading={loadingProducts}
              disabled={!plan.providerLineId}
              placeholder={lineProducts.length > 0 ? '选择已同步的上游产品' : '先在转售配置页配置线路并刷新目录'}
              optionFilterProp="label"
              options={productOptions}
              notFoundContent={loadingProducts ? '读取上游产品目录中...' : '暂无已同步上游产品'}
            />
          </Form.Item>
        </Space>
      </Form>

      {lineProducts.length === 0 && !loadingProducts && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 18 }}
          message="暂无可选择的上游产品"
          description="请先到转售配置页确认供应商线路、PartnerCode / Secret 和上游套餐同步状态，然后刷新目录。套餐详情页只允许从目录选择，不再手填 productId。"
          action={(
            <Space>
              <Button size="small" icon={<ReloadOutlined />} onClick={onRefresh}>
                刷新目录
              </Button>
              <Button size="small" onClick={() => navigate('/coding-plan/resale-config')}>
                转售配置
              </Button>
            </Space>
          )}
        />
      )}

      <div
        style={{
          marginTop: 4,
          padding: '16px 18px',
          border: '1px solid var(--border-soft)',
          borderRadius: 8,
          background: '#fff',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
          <div>
            <Typography.Title level={5} style={{ margin: 0 }}>
              履约口径
            </Typography.Title>
            <Text type="secondary">
              Raytone 销售价格仍在价格 Tab 配置；上游套餐权益只从供应商目录继承。
            </Text>
          </div>
          <Tag color={plan.providerLineId ? 'blue' : 'default'}>
            {plan.providerLineCode ?? plan.providerLineId ?? '未选择线路'}
          </Tag>
        </div>

        <Descriptions
          size="small"
          bordered
          column={1}
          items={[
            {
              key: 'catalog',
              label: '上游目录来源',
              children: 'billing provider-line sync catalog',
            },
            {
              key: 'selectedProduct',
              label: '当前上游产品',
              children: selectedProduct
                ? `${selectedProduct.productName} (${selectedProduct.upstreamProductId})`
                : plan.upstreamProductId || '未选择',
            },
            {
              key: 'productCycle',
              label: '周期 / 类型',
              children: selectedProduct
                ? `${selectedProduct.productCycle ?? '-'} / ${selectedProduct.productType ?? '-'}`
                : '随上游目录同步',
            },
            {
              key: 'salesLimits',
              label: '销售限制',
              children: selectedProduct
                ? `日 ${formatLimit(selectedProduct.dailySalesLimit)} / 月 ${formatLimit(selectedProduct.monthlySalesLimit)} / 年 ${formatLimit(selectedProduct.yearlySalesLimit)} / 总 ${formatLimit(selectedProduct.maxSalesLimit)}`
                : '随上游目录同步',
            },
            {
              key: 'fulfillment',
              label: '订单履约',
              children: '付款成功后按 providerLineId + upstreamProductId 创建供应商订单。',
            },
            {
              key: 'partnerUserId',
              label: '激活用户 ID',
              children: '付款成功后取 Raytone user.id，写入供应商订单 partnerUserId。',
            },
            {
              key: 'partnerOrderNo',
              label: 'partnerOrderNo',
              children: 'Raytone 订单号；同一订单重复请求保持幂等。',
            },
            {
              key: 'keyPolicy',
              label: '上游 Key 策略',
              children: '每个 Raytone 订单独立生成一个供应商 upstream key，仅内部托管。',
            },
            {
              key: 'raytoneKeys',
              label: '用户 API Key',
              children: '用户只创建和使用 Raytone API Key；同一 CodingPlan 订阅下允许创建多个 Raytone key。',
            },
          ]}
        />
      </div>
    </div>
  );
}
