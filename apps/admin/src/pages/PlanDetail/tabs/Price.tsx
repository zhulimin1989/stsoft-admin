import { useCallback, useEffect, useState } from 'react';
import { Form, Select, Button, Tag, Switch, Space, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import { planApi } from '../../../api/admin';
import { DataTable, EmptyPlaceholder, StableNumberInput } from '../../../components/common';
import { usePlatformCurrency } from '../../../contexts/PlatformConfigContext';
import { currencyMinorUnitLabel } from '../../../utils/price';
import {
  normalizePlanPriceCurrency,
  planPriceCurrencyOptions,
} from '../planPriceCurrency';
import type { PlanDetailChange, PlanDetailState, PlanPriceRow } from '../types';

interface Props {
  plan: PlanDetailState;
  onChange: PlanDetailChange;
  canManage?: boolean;
  /** 是否在顶部展示「计费」字段（计费周期 / 默认价 cents）。自营 CodingPlan 传 true。默认 false（通用套餐保持原样，仅试用天数）。 */
  showBillingFields?: boolean;
}

function getApiErrorMessage(error: unknown): string {
  const candidate = error as { response?: { data?: { message?: unknown } }; message?: unknown };
  const apiMessage = candidate.response?.data?.message;
  if (typeof apiMessage === 'string' && apiMessage.trim()) return apiMessage;
  if (typeof candidate.message === 'string' && candidate.message.trim()) return candidate.message;
  return '未知错误';
}

export function PriceTab({ plan, onChange, canManage = true, showBillingFields = false }: Props) {
  const platformCurrency = usePlatformCurrency();
  const defaultPriceCurrency = normalizePlanPriceCurrency(platformCurrency);
  const currencyOptions = planPriceCurrencyOptions(platformCurrency);
  const minorUnitLabel = currencyMinorUnitLabel(platformCurrency);
  const planId = plan?.id;
  const isNew = !planId || planId === 'new';
  const [form] = Form.useForm();

  useEffect(() => {
    form.setFieldsValue(plan);
  }, [form, plan]);

  const [prices, setPrices] = useState<PlanPriceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [newCurrency, setNewCurrency] = useState(defaultPriceCurrency);
  const [newMonthly, setNewMonthly] = useState(0);
  const [newQuarterly, setNewQuarterly] = useState(0);
  const [newYearly, setNewYearly] = useState(0);

  useEffect(() => {
    setNewCurrency(defaultPriceCurrency);
  }, [defaultPriceCurrency]);

  const reload = useCallback(async () => {
    if (isNew) return;
    setLoading(true);
    try {
      const r = await planApi.listPrices(planId);
      setPrices(r.prices || []);
    } catch (e) {
      console.error('Load plan prices failed', e);
    } finally {
      setLoading(false);
    }
  }, [planId, isNew]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleUpsert(row: PlanPriceRow) {
    try {
      await planApi.upsertPrice(planId, row.currency, {
        monthlyPrice: row.monthlyPrice,
        quarterlyPrice: row.quarterlyPrice,
        yearlyPrice: row.yearlyPrice,
        isActive: row.isActive,
      });
      message.success(`${row.currency.toUpperCase()} 已保存`);
      await reload();
    } catch (e: unknown) {
      message.error(`保存失败: ${getApiErrorMessage(e)}`);
    }
  }

  async function handleDelete(currency: string) {
    try {
      await planApi.deletePrice(planId, currency);
      message.success(`${currency.toUpperCase()} 已删除`);
      await reload();
    } catch (e: unknown) {
      message.error(`删除失败: ${getApiErrorMessage(e)}`);
    }
  }

  async function handleAddNew() {
    if (prices.some((p) => p.currency === newCurrency)) {
      message.warning(`${newCurrency.toUpperCase()} 已存在,可直接在表格中修改`);
      return;
    }
    await handleUpsert({
      planId,
      currency: newCurrency,
      monthlyPrice: newMonthly,
      quarterlyPrice: newQuarterly,
      yearlyPrice: newYearly,
      isActive: true,
    });
    setNewMonthly(0);
    setNewQuarterly(0);
    setNewYearly(0);
  }

  const columns: ColumnsType<PlanPriceRow> = [
    { title: '币种', dataIndex: 'currency', width: 80, render: (c: string) => <Tag>{c.toUpperCase()}</Tag> },
    {
      title: '月付 (最小单位/月)',
      dataIndex: 'monthlyPrice',
      width: 180,
      render: (_: unknown, row: PlanPriceRow, idx: number) => (
        <StableNumberInput
          value={row.monthlyPrice}
          min={0}
          precision={0}
          disabled={!canManage}
          onChange={(v) =>
            setPrices((prev) => prev.map((p, i) => (i === idx ? { ...p, monthlyPrice: v ?? 0 } : p)))
          }
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: '季付月均价 (最小单位/月)',
      dataIndex: 'quarterlyPrice',
      width: 200,
      render: (_: unknown, row: PlanPriceRow, idx: number) => (
        <StableNumberInput
          value={row.quarterlyPrice}
          min={0}
          precision={0}
          disabled={!canManage}
          onChange={(v) =>
            setPrices((prev) => prev.map((p, i) => (i === idx ? { ...p, quarterlyPrice: v ?? 0 } : p)))
          }
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: '年付月均价 (最小单位/月)',
      dataIndex: 'yearlyPrice',
      width: 200,
      render: (_: unknown, row: PlanPriceRow, idx: number) => (
        <StableNumberInput
          value={row.yearlyPrice}
          min={0}
          precision={0}
          disabled={!canManage}
          onChange={(v) =>
            setPrices((prev) => prev.map((p, i) => (i === idx ? { ...p, yearlyPrice: v ?? 0 } : p)))
          }
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: '启用',
      dataIndex: 'isActive',
      width: 80,
      render: (_: unknown, row: PlanPriceRow, idx: number) => (
        <Switch
          checked={row.isActive}
          disabled={!canManage}
          onChange={(v) =>
            setPrices((prev) => prev.map((p, i) => (i === idx ? { ...p, isActive: v } : p)))
          }
        />
      ),
    },
    {
      title: '操作',
      width: 180,
      render: (_: unknown, row: PlanPriceRow) => (
        <Space>
          <Button size="small" type="primary" disabled={!canManage} onClick={() => handleUpsert(row)}>
            保存
          </Button>
          <Button size="small" danger disabled={!canManage} onClick={() => handleDelete(row.currency)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Form
        form={form}
        layout="vertical"
        onValuesChange={(_, values) => onChange({ ...plan, ...values })}
        style={{ marginBottom: 24 }}
      >
        {showBillingFields && (
          <Space size={24} align="start" wrap style={{ marginBottom: 4 }}>
            <Form.Item label="计费周期" name="billingPeriod">
              <Select
                style={{ width: 160 }}
                options={[
                  { value: 'monthly', label: '月付' },
                  { value: 'quarterly', label: '季付' },
                  { value: 'yearly', label: '年付' },
                ]}
              />
            </Form.Item>
            <Form.Item label={`月付价格 (${minorUnitLabel})`} name="monthlyPrice" tooltip="默认价（系统币种回退）；多币种价格在下方维护">
              <StableNumberInput min={0} precision={0} style={{ width: 180 }} />
            </Form.Item>
            <Form.Item label={`季付月均价 (${minorUnitLabel})`} name="quarterlyPrice">
              <StableNumberInput min={0} precision={0} style={{ width: 180 }} />
            </Form.Item>
            <Form.Item label={`年付月均价 (${minorUnitLabel})`} name="yearlyPrice">
              <StableNumberInput min={0} precision={0} style={{ width: 180 }} />
            </Form.Item>
          </Space>
        )}
        <Form.Item label="试用天数" name="trialDays">
          <StableNumberInput min={0} precision={0} placeholder="天" style={{ width: 200 }} />
        </Form.Item>
        {/* TODO(Phase-3): 试用结束策略字段 schema 已定义,后端就绪后接入 */}
      </Form>

      {isNew ? (
        <EmptyPlaceholder title="多币种价格" description="保存套餐后可配置多币种价格" />
      ) : (
        <>
          <div
            style={{
              marginBottom: 12,
              padding: '10px 14px',
              background: '#f9fafb',
              borderRadius: 8,
              fontSize: 13,
              color: '#4b5563',
            }}
          >
            多币种价格表。前端按用户选的币种查这里。若系统币种无记录，会回落到上方"月价/季价/年价"字段，其他币种会报错。
            季付/年付价格以"月均价"存储，扣款时分别 ×3 / ×12。
          </div>
          <DataTable<PlanPriceRow>
            rowKey={(r) => r.currency}
            loading={loading}
            dataSource={prices}
            columns={columns}
            pagination={false}
            size="middle"
            locale={{ emptyText: '暂无多币种价格,请在下方添加' }}
          />
          <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
            <Select
              value={newCurrency}
              onChange={setNewCurrency}
              style={{ width: 100 }}
              options={currencyOptions}
              disabled={!canManage}
            />
            <StableNumberInput
              value={newMonthly}
              onChange={(v) => setNewMonthly(v ?? 0)}
              placeholder="月付最小单位"
              min={0}
              precision={0}
              disabled={!canManage}
              style={{ width: 160 }}
            />
            <StableNumberInput
              value={newQuarterly}
              onChange={(v) => setNewQuarterly(v ?? 0)}
              placeholder="季付月均价最小单位"
              min={0}
              precision={0}
              disabled={!canManage}
              style={{ width: 190 }}
            />
            <StableNumberInput
              value={newYearly}
              onChange={(v) => setNewYearly(v ?? 0)}
              placeholder="年付月均价最小单位"
              min={0}
              precision={0}
              disabled={!canManage}
              style={{ width: 200 }}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAddNew} disabled={!canManage}>
              添加币种
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
