import { useEffect } from 'react';
import { Form, Input, Select, Switch } from 'antd';
import { StableNumberInput } from '../../../components/common';
import { usePlatformCurrency } from '../../../contexts/PlatformConfigContext';
import { currencyMinorUnitLabel, formatCurrencyCents } from '../../../utils/price';
import type { PlanDetailChange, PlanDetailState, ProductInfo } from '../types';

interface Props {
  plan: PlanDetailState;
  onChange: PlanDetailChange;
  products?: ProductInfo[];
  isNew?: boolean;
  canManage?: boolean;
}

export function OverviewTab({ plan, onChange, products = [], isNew = false, canManage = true }: Props) {
  const platformCurrency = usePlatformCurrency();
  const minorUnitLabel = currencyMinorUnitLabel(platformCurrency);
  const [form] = Form.useForm<PlanDetailState>();

  useEffect(() => {
    form.setFieldsValue({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      productId: plan.productId,
      planType: plan.planType,
      billingPeriod: plan.billingPeriod,
      monthlyPrice: plan.monthlyPrice,
      quarterlyPrice: plan.quarterlyPrice,
      yearlyPrice: plan.yearlyPrice,
      monthlyCredits: plan.monthlyCredits,
      creditsRollover: plan.creditsRollover,
      rolloverMaxMonths: plan.rolloverMaxMonths,
      badge: plan.badge,
      sortOrder: plan.sortOrder,
      isActive: plan.isActive,
      isLegacy: plan.isLegacy,
    });
  }, [form, plan]);

  const handleValuesChange = (_: Partial<PlanDetailState>, values: PlanDetailState) => {
    const next: PlanDetailState = {
      ...plan,
      ...values,
    };

    form.setFieldsValue({
      planType: next.planType,
    });
    onChange(next);
  };

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={plan}
      disabled={!canManage}
      onValuesChange={handleValuesChange}
    >
      {isNew && (
        <Form.Item label="套餐 ID" name="id" tooltip="留空则自动生成 UUID">
          <Input placeholder="自动生成 UUID, 如 free / pro / max" />
        </Form.Item>
      )}
      <Form.Item label="套餐名称" name="name" rules={[{ required: true }]}>
        <Input placeholder="如:标准版" />
      </Form.Item>
      <Form.Item label="描述" name="description">
        <Input.TextArea rows={2} placeholder="套餐简介" />
      </Form.Item>
      <Form.Item label="所属产品" name="productId" rules={[{ required: true, message: '请选择订阅计费产品' }]}>
        <Select
          placeholder="选择订阅计费产品"
          options={products.map((p) => ({ value: p.id, label: `${p.name} (${p.slug})` }))}
        />
      </Form.Item>
      <Form.Item label="计费类型" name="planType">
        <Select
          options={[
            { value: 'individual', label: '个人' },
            { value: 'team', label: '团队' },
            { value: 'enterprise', label: '企业' },
          ]}
        />
      </Form.Item>
      <Form.Item label="计费周期" name="billingPeriod">
        <Select
          options={[
            { value: 'monthly', label: '月付' },
            { value: 'yearly', label: '年付' },
            { value: 'quarterly', label: '季付' },
          ]}
        />
      </Form.Item>
      <Form.Item
        label={`月付价格 (${minorUnitLabel}/月)`}
        name="monthlyPrice"
        tooltip={`100 ${minorUnitLabel} = ${formatCurrencyCents(100, platformCurrency)}`}
      >
        <StableNumberInput min={0} precision={0} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item label={`季付月均价 (${minorUnitLabel}/月)`} name="quarterlyPrice">
        <StableNumberInput min={0} precision={0} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item label={`年付月均价 (${minorUnitLabel}/月)`} name="yearlyPrice">
        <StableNumberInput min={0} precision={0} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item label="月度积分" name="monthlyCredits">
        <StableNumberInput min={0} precision={0} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item label="积分滚存" name="creditsRollover" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item label="结转月数" name="rolloverMaxMonths">
        <StableNumberInput min={0} precision={0} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item label="徽章" name="badge">
        <Input placeholder="如:最受欢迎" />
      </Form.Item>
      <Form.Item label="排序" name="sortOrder">
        <StableNumberInput min={0} precision={0} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item label="启用" name="isActive" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item label="旧版标记" name="isLegacy" valuePropName="checked" tooltip="已下架但老用户保留">
        <Switch />
      </Form.Item>
    </Form>
  );
}
