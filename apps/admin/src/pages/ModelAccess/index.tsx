import { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Tag,
  Button,
  Space,
  Switch,
  message,
  Typography,
} from 'antd';
import { SaveOutlined, ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { modelAccessApi, channelApi, planApi, modelPricingApi } from '../../api/admin';
import { DataTable } from '../../components/common';
import { usePermission } from '../../hooks/usePermission';

const TIER_COLORS: Record<string, string> = {
  free: 'default',
  pro: 'blue',
  max: 'gold',
  basic: 'cyan',
  premium: 'purple',
  enterprise: 'red',
};

interface PlanInfo {
  id: string;
  name: string;
  tier?: string;
}

interface CellState {
  id?: string;
  isActive: boolean;
}

type MatrixData = Record<string, Record<string, CellState>>;

interface ChannelModel {
  model: string;
  displayName?: string;
  provider?: string;
}

export default function ModelAccessPage() {
  const canManage = usePermission('admin.page.model_access.manage');
  const [matrix, setMatrix] = useState<MatrixData>({});
  const [models, setModels] = useState<string[]>([]);
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [availableModels, setAvailableModels] = useState<ChannelModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [accessRes, channelsRes, plansRes] = await Promise.all([
        modelAccessApi.list(),
        channelApi.list({ page: 1, pageSize: 100 }),
        planApi.list(),
      ]);

      // Parse plans
      const planItems = plansRes?.items || plansRes || [];
      const fetchedPlans: PlanInfo[] = planItems.map((p: Record<string, unknown>) => ({
        id: (p.id || p.tier || p.name) as string,
        name: (p.name || p.tier || p.id) as string,
        tier: (p.tier || p.id) as string,
      }));
      // Fallback: if no plans returned, use defaults
      const activePlans = fetchedPlans.length > 0
        ? fetchedPlans
        : [{ id: 'free', name: 'Free', tier: 'free' }, { id: 'pro', name: 'Pro', tier: 'pro' }, { id: 'max', name: 'Max', tier: 'max' }];
      setPlans(activePlans);

      const accessItems = accessRes?.items || accessRes || [];
      // Extract models from channels data
      const channelItems = channelsRes?.items || channelsRes || [];
      const allModels: ChannelModel[] = [];
      for (const ch of channelItems) {
        if (ch.models && Array.isArray(ch.models)) {
          for (const m of ch.models) {
            if (typeof m === 'string' && m !== '*') {
              allModels.push({ model: m, provider: ch.provider });
            }
          }
        }
      }
      setAvailableModels(allModels);

      // 模型来源：channels + model_pricing（不从 model_access 补充，避免旧脏数据）
      const modelSet = new Set<string>();
      allModels.forEach((m) => modelSet.add(m.model));
      // 补充 model_pricing
      try {
        const mpRes = await modelPricingApi.list();
        const pricings = mpRes.items || mpRes || [];
        for (const p of pricings) {
          if (p.modelName) {
            modelSet.add(p.modelName);
            if (!allModels.find((m: ChannelModel) => m.model === p.modelName)) {
              allModels.push({ model: p.modelName });
            }
          }
        }
      } catch { /* non-critical */ }
      const sortedModels = Array.from(modelSet).sort();
      setModels(sortedModels);

      const tierIds = activePlans.map((p) => p.id);
      const newMatrix: MatrixData = {};
      for (const modelName of sortedModels) {
        newMatrix[modelName] = {};
        for (const tierId of tierIds) {
          newMatrix[modelName][tierId] = {
            isActive: false,
          };
        }
      }

      for (const item of accessItems) {
        const mName = item.modelName || item.model_name;
        const tId = item.planId || item.tierId || item.plan_id || item.tier_id;
        if (newMatrix[mName] && newMatrix[mName][tId] !== undefined) {
          newMatrix[mName][tId] = {
            id: item.id,
            isActive: item.isActive ?? item.is_active,
          };
        }
      }

      setMatrix(newMatrix);
      setDirty(false);
    } catch {
      message.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const updateCell = (modelName: string, tierId: string, patch: Partial<CellState>) => {
    setMatrix((prev) => ({
      ...prev,
      [modelName]: {
        ...prev[modelName],
        [tierId]: {
          ...prev[modelName][tierId],
          ...patch,
        },
      },
    }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: Record<string, unknown>[] = [];
      for (const modelName of models) {
        for (const plan of plans) {
          const cell = matrix[modelName]?.[plan.id];
          if (!cell) continue;
          if (cell.isActive || cell.id) {
            updates.push({
              tierId: plan.id,
              modelName,
              isActive: cell.isActive,
            });
          }
        }
      }
      await modelAccessApi.batchUpdate(updates);
      message.success(`成功保存 ${updates.length} 条权限`);
      setDirty(false);
      fetchData();
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const getModelProvider = (modelName: string) => {
    const m = availableModels.find((am) => am.model === modelName);
    return m?.provider || '';
  };

  const columns = [
    {
      title: '模型',
      key: 'model',
      width: 220,
      fixed: 'left' as const,
      render: (_: unknown, record: { modelName: string }) => (
        <div>
          <div style={{ fontWeight: 500 }}>{record.modelName}</div>
          {getModelProvider(record.modelName) && (
            <Tag style={{ marginTop: 4, fontSize: 11 }}>{getModelProvider(record.modelName)}</Tag>
          )}
        </div>
      ),
    },
    ...plans.map((plan) => ({
      title: <Tag color={TIER_COLORS[plan.id] || TIER_COLORS[plan.tier || ''] || 'blue'}>{plan.name}</Tag>,
      key: plan.id,
      width: 160,
      render: (_: unknown, record: { modelName: string }) => {
        const cell = matrix[record.modelName]?.[plan.id];
        if (!cell) return '-';
        return (
          <Space direction="vertical" size={4}>
            <Switch
              size="small"
              checked={cell.isActive}
              disabled={!canManage}
              onChange={(v) => updateCell(record.modelName, plan.id, { isActive: v })}
              checkedChildren="启用"
              unCheckedChildren="禁用"
            />
          </Space>
        );
      },
    })),
  ];

  const dataSource = models.map((modelName) => ({ modelName, key: modelName }));

  return (
    <div>
      <h2 style={{ marginBottom: 24, fontSize: 20, fontWeight: 600 }}>
        <SafetyCertificateOutlined /> 模型权限矩阵
      </h2>

      <Card bordered={false}>
        <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
          <Typography.Text type="secondary">
            控制各套餐能使用哪些模型。具体任务走哪个模型在套餐详情的“模型路由策略”里配置。
          </Typography.Text>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={saving}
              disabled={!canManage || !dirty}
            >
              {dirty ? '保存更改' : '已保存'}
            </Button>
          </Space>
        </Space>

        <DataTable
          dataSource={dataSource}
          columns={columns}
          loading={loading}
          searchable
          searchPlaceholder="搜索模型 / 产品"
          pagination={false}
          scroll={{ x: 900 }}
          size="middle"
        />
      </Card>
    </div>
  );
}
