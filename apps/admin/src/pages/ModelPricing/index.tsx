import { useState, useEffect, useCallback } from 'react';
import {
  App,
  Card,
  Button,
  Space,
  Switch,
  Typography,
  Tag,
} from 'antd';
import {
  SaveOutlined,
  ReloadOutlined,
  SyncOutlined,
  DollarOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { modelPricingApi } from '../../api/admin';
import { DataTable, StableNumberInput } from '../../components/common';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { modelUnitPriceInputProps } from '../../utils/price';

interface PricingRow {
  id?: string;
  modelName: string;
  inputPricePerMToken: number;
  cachedInputPrice: number | null;
  cacheWrite5minPrice: number | null;
  cacheWrite1hPrice: number | null;
  outputPricePerMToken: number;
  isActive: boolean;
}

interface EditState {
  inputPricePerMToken?: number;
  cachedInputPrice?: number | null;
  cacheWrite5minPrice?: number | null;
  cacheWrite1hPrice?: number | null;
  outputPricePerMToken?: number;
  isActive?: boolean;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null) {
    const response = 'response' in error ? error.response : undefined;
    if (typeof response === 'object' && response !== null && 'data' in response) {
      const data = response.data;
      if (typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string') {
        return data.message;
      }
    }
    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }
  }
  return fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function displayCacheWritePrice(row: {
  cacheWrite5minPrice?: number | null;
  cacheWrite1hPrice?: number | null;
}): number | null {
  return row.cacheWrite5minPrice ?? row.cacheWrite1hPrice ?? null;
}

export default function ModelPricingPage() {
  const { modal, message } = App.useApp();
  const platformCurrency = usePlatformCurrency();
  const priceInputProps = modelUnitPriceInputProps(platformCurrency);
  const [rows, setRows] = useState<PricingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [deactivatingOrphans, setDeactivatingOrphans] = useState(false);
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [savingRows, setSavingRows] = useState<Record<string, boolean>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await modelPricingApi.list();
      const items: PricingRow[] = (data?.items || data || []).map((item: Record<string, unknown>) => ({
        id: item.id as string | undefined,
        modelName: (item.modelName || item.model_name) as string,
        inputPricePerMToken: (item.inputPricePerMToken ?? item.input_price_per_m_token ?? 0) as number,
        cachedInputPrice: nullableNumber(item.cachedInputPrice ?? item.cached_input_price_cents),
        cacheWrite5minPrice: nullableNumber(
          item.cacheWrite5minPrice ??
            item.cache_write_5min_price_cents ??
            item.cacheWrite1hPrice ??
            item.cache_write_1h_price_cents,
        ),
        cacheWrite1hPrice: nullableNumber(item.cacheWrite1hPrice ?? item.cache_write_1h_price_cents),
        outputPricePerMToken: (item.outputPricePerMToken ?? item.output_price_per_m_token ?? 0) as number,
        isActive: (item.isActive ?? item.is_active ?? true) as boolean,
      }));
      items.sort((a, b) => a.modelName.localeCompare(b.modelName));
      setRows(items);
      setEdits({});
    } catch {
      message.error('加载定价数据失败');
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await modelPricingApi.sync();
      const count = result?.synced ?? result?.count ?? 0;
      message.success(`同步完成，共同步 ${count} 个模型`);
      fetchData();
    } catch {
      message.error('同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const handleDeactivateOrphans = async () => {
    setDeactivatingOrphans(true);
    try {
      // Step 1: preview
      const preview = await modelPricingApi.deactivateOrphans(false);
      const orphans: string[] = preview?.orphans ?? [];

      if (orphans.length === 0) {
        message.info('没有孤儿定价，所有 active 模型都有 Channel 覆盖');
        return;
      }

      // Step 2: confirm
      modal.confirm({
        title: `确认禁用 ${orphans.length} 个孤儿定价？`,
        width: 560,
        content: (
          <div>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
              以下 ModelPricing 条目处于 active 状态，但没有任何 active Channel 覆盖，
              用户选择这些模型调用会返回 404。点击确认后它们将被标记为 isActive=false
              （数据保留，不会删除）。
            </Typography.Paragraph>
            <div
              style={{
                maxHeight: 240,
                overflow: 'auto',
                background: '#fafafa',
                padding: 12,
                borderRadius: 4,
                border: '1px solid #f0f0f0',
              }}
            >
              {orphans.map((name) => (
                <Tag key={name} style={{ marginBottom: 6 }}>
                  {name}
                </Tag>
              ))}
            </div>
          </div>
        ),
        okText: `确认禁用 ${orphans.length} 个`,
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            const result = await modelPricingApi.deactivateOrphans(true);
            message.success(`已禁用 ${result?.deactivated ?? 0} 个孤儿定价`);
            fetchData();
          } catch (error) {
            message.error(getErrorMessage(error, '禁用失败'));
            throw error;
          }
        },
      });
    } catch (error) {
      message.error(getErrorMessage(error, '获取孤儿定价失败'));
    } finally {
      setDeactivatingOrphans(false);
    }
  };

  const updateEdit = (modelName: string, field: keyof EditState, value: number | boolean | null) => {
    setEdits((prev) => ({
      ...prev,
      [modelName]: {
        ...prev[modelName],
        [field]: value,
      },
    }));
  };

  const getDisplayValue = (row: PricingRow, field: keyof EditState): number | boolean | null => {
    const edit = edits[row.modelName];
    if (edit && edit[field] !== undefined) {
      return edit[field] as number | boolean | null;
    }
    return row[field];
  };

  const isRowDirty = (modelName: string): boolean => {
    return !!edits[modelName] && Object.keys(edits[modelName]).length > 0;
  };

  const handleSaveRow = async (row: PricingRow) => {
    const edit = edits[row.modelName] || {};
    const editedNullable = (
      field: 'cachedInputPrice' | 'cacheWrite5minPrice',
      fallback: number | null,
    ) => (Object.prototype.hasOwnProperty.call(edit, field) ? edit[field] ?? null : fallback);
    const cacheWritePrice = editedNullable('cacheWrite5minPrice', displayCacheWritePrice(row));
    const payload = {
      modelName: row.modelName,
      inputPricePerMToken: (edit.inputPricePerMToken ?? row.inputPricePerMToken),
      cachedInputPrice: editedNullable('cachedInputPrice', row.cachedInputPrice),
      cacheWrite5minPrice: cacheWritePrice,
      cacheWrite1hPrice: cacheWritePrice,
      outputPricePerMToken: (edit.outputPricePerMToken ?? row.outputPricePerMToken),
      isActive: (edit.isActive ?? row.isActive),
    };

    setSavingRows((prev) => ({ ...prev, [row.modelName]: true }));
    try {
      await modelPricingApi.upsert(payload);
      message.success(`${row.modelName} 定价已保存`);
      setEdits((prev) => {
        const next = { ...prev };
        delete next[row.modelName];
        return next;
      });
      fetchData();
    } catch {
      message.error(`保存 ${row.modelName} 失败`);
    } finally {
      setSavingRows((prev) => ({ ...prev, [row.modelName]: false }));
    }
  };

  const columns = [
    {
      title: '模型名称',
      dataIndex: 'modelName',
      key: 'modelName',
      width: 280,
      render: (name: string) => (
        <span style={{ fontWeight: 500 }}>{name}</span>
      ),
    },
    {
      title: `input (${platformCurrency}/1M)`,
      key: 'inputPricePerMToken',
      width: 150,
      render: (_: unknown, record: PricingRow) => (
        <StableNumberInput
          size="small"
          {...priceInputProps}
          value={getDisplayValue(record, 'inputPricePerMToken') as number}
          onChange={(v) => updateEdit(record.modelName, 'inputPricePerMToken', v ?? 0)}
          style={{ width: 130 }}
        />
      ),
    },
    {
      title: `cache read (${platformCurrency}/1M)`,
      key: 'cachedInputPrice',
      width: 160,
      render: (_: unknown, record: PricingRow) => (
        <StableNumberInput
          size="small"
          {...priceInputProps}
          value={getDisplayValue(record, 'cachedInputPrice') as number | null}
          onChange={(v) => updateEdit(record.modelName, 'cachedInputPrice', v ?? null)}
          style={{ width: 130 }}
        />
      ),
    },
    {
      title: `cache write (${platformCurrency}/1M)`,
      key: 'cacheWrite5minPrice',
      width: 170,
      render: (_: unknown, record: PricingRow) => {
        const edit = edits[record.modelName];
        const value = edit && Object.prototype.hasOwnProperty.call(edit, 'cacheWrite5minPrice')
          ? edit.cacheWrite5minPrice ?? null
          : displayCacheWritePrice(record);
        return (
          <StableNumberInput
            size="small"
            {...priceInputProps}
            value={value}
            onChange={(v) => updateEdit(record.modelName, 'cacheWrite5minPrice', v ?? null)}
            style={{ width: 130 }}
          />
        );
      },
    },
    {
      title: `output (${platformCurrency}/1M)`,
      key: 'outputPricePerMToken',
      width: 150,
      render: (_: unknown, record: PricingRow) => (
        <StableNumberInput
          size="small"
          {...priceInputProps}
          value={getDisplayValue(record, 'outputPricePerMToken') as number}
          onChange={(v) => updateEdit(record.modelName, 'outputPricePerMToken', v ?? 0)}
          style={{ width: 130 }}
        />
      ),
    },
    {
      title: '状态',
      key: 'isActive',
      width: 120,
      render: (_: unknown, record: PricingRow) => (
        <Switch
          size="small"
          checked={getDisplayValue(record, 'isActive') as boolean}
          onChange={(v) => updateEdit(record.modelName, 'isActive', v)}
          checkedChildren="启用"
          unCheckedChildren="禁用"
        />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 100,
      render: (_: unknown, record: PricingRow) => {
        const dirty = isRowDirty(record.modelName);
        return (
          <Button
            type="primary"
            size="small"
            icon={<SaveOutlined />}
            disabled={!dirty}
            loading={savingRows[record.modelName]}
            onClick={() => handleSaveRow(record)}
          >
            保存
          </Button>
        );
      },
    },
  ];

  return (
    <div>
      <h2 style={{ marginBottom: 8, fontSize: 20, fontWeight: 600 }}>
        <DollarOutlined /> 模型定价管理
      </h2>
      <p style={{ color: '#6b7280', marginBottom: 16 }}>
        此页定价仅用于 API 按量计费（扣钱包余额）。SaaS 产品的积分消耗由套餐内的模型倍率控制，请在套餐编辑页配置。
      </p>

      <Card bordered={false}>
        <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
          <Typography.Text type="secondary">
            按 input / cache read / cache write / output 配置模型价格。单位均为 {platformCurrency} / 1M token。
          </Typography.Text>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
            <Button
              icon={<DeleteOutlined />}
              onClick={handleDeactivateOrphans}
              loading={deactivatingOrphans}
              danger
            >
              标记孤儿定价为不活跃
            </Button>
            <Button
              type="primary"
              icon={<SyncOutlined />}
              onClick={handleSync}
              loading={syncing}
              style={{ background: '#1a1a1a', borderColor: '#1a1a1a' }}
            >
              从代理同步模型
            </Button>
          </Space>
        </Space>

        <DataTable<PricingRow>
          dataSource={rows}
          columns={columns}
          loading={loading}
          searchable
          searchPlaceholder="搜索模型名称 / Provider"
          pagination={false}
          scroll={{ x: 1040 }}
          size="middle"
          rowKey="modelName"
          rowClassName={(record) => isRowDirty(record.modelName) ? 'ant-table-row-selected' : ''}
        />

        {rows.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Tag>共 {rows.length} 个模型</Tag>
            <Tag color="green">{rows.filter((r) => (getDisplayValue(r, 'isActive') as boolean)).length} 个启用</Tag>
            <Tag color="default">{rows.filter((r) => !(getDisplayValue(r, 'isActive') as boolean)).length} 个禁用</Tag>
          </div>
        )}
      </Card>

    </div>
  );
}
