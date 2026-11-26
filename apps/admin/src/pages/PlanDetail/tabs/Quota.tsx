import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Form, Select, Space, Switch, Tag, Typography } from 'antd';
import { quotaTemplateApi, type PlanQuotaTemplate, type QuotaRule } from '../../../api/v2/quotaTemplates';
import { StableNumberInput } from '../../../components/common';
import { warnNonCritical } from '../../../utils/logging';
import type { PlanDetailChange, PlanDetailState } from '../types';

interface Props {
  plan: PlanDetailState;
  onChange: PlanDetailChange;
  /** 是否展示「积分额度」区（月度积分/滚存/结转）。自营 CodingPlan 传 true。默认 false（通用套餐保持原样）。 */
  showCreditsAllowance?: boolean;
  /**
   * 隐藏 RPM/TPM/最大上下文三个套餐级散字段输入。自营 CodingPlan 传 true：
   * 配额一律来自配额模板（保存时散字段归 0，用户端按模板规则展示），
   * 这三个输入只剩误导性，参见设计 me/plan-quota-display-from-template.md。
   * 通用套餐/默认 false 保持原样。
   */
  hideRateLimitFields?: boolean;
  canManage?: boolean;
}

const { Text } = Typography;
const QUOTA_TEMPLATE_ROUTE = '/coding-plan/quota-templates';

function formatIntegerInput(value: number | string | undefined): string {
  if (value === undefined || value === '') return '';
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function parseIntegerInput(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

const METRIC_LABEL: Record<QuotaRule['metric'], string> = {
  REQUESTS: '请求',
  INPUT_TOKENS: '输入 Token',
  OUTPUT_TOKENS: '输出 Token',
  TOTAL_TOKENS: '总 Token',
  CREDITS: '积分',
};

const WINDOW_LABEL: Record<QuotaRule['windowType'], string> = {
  ROLLING: '滚动',
  FIXED_PERIOD: '固定周期',
  CUMULATIVE: '累计',
};

function ruleText(rule: QuotaRule): string {
  const metric = METRIC_LABEL[rule.metric] ?? rule.metric;
  const windowType = WINDOW_LABEL[rule.windowType] ?? rule.windowType;
  return `${windowType} ${rule.durationLabel}: ${metric} <= ${rule.limitValue.toLocaleString()}`;
}

// 网关真实执行口径的指标集合（quota-v2：ROLLING + {REQUESTS,CREDITS} + 任意正窗口）。
const ENFORCED_METRICS = new Set<QuotaRule['metric']>(['REQUESTS', 'CREDITS']);

/**
 * 规则是否按当前网关下发口径真实执行。必须与 codesphere-billing 仓
 * plan-quota-rule-views.ts 的 isQuotaRuleEnforced 保持一致：
 * quota-v2 后为 ROLLING + {REQUESTS,CREDITS} + 任意正窗口（不再硬编码 6h、且纳入 CREDITS）。
 */
function isRuleEnforced(rule: QuotaRule): boolean {
  return (
    rule.windowType === 'ROLLING'
    && ENFORCED_METRICS.has(rule.metric)
    && rule.durationSec > 0
    && rule.limitValue > 0
  );
}

/** durationSec → 用户视角的窗口文案（每 N 天/小时/分钟）。 */
function windowText(durationSec: number): string {
  if (durationSec % 86400 === 0) return `每 ${durationSec / 86400} 天`;
  if (durationSec % 3600 === 0) return `每 ${durationSec / 3600} 小时`;
  if (durationSec % 60 === 0) return `每 ${durationSec / 60} 分钟`;
  return `每 ${durationSec} 秒`;
}

/** 用户视角的指标文案（与用户前端 i18n 口径一致）。 */
const USER_METRIC_LABEL: Record<QuotaRule['metric'], string> = {
  REQUESTS: '次请求',
  INPUT_TOKENS: '输入 Tokens',
  OUTPUT_TOKENS: '输出 Tokens',
  TOTAL_TOKENS: 'Tokens',
  CREDITS: '积分',
};

export function QuotaTab({
  plan,
  onChange,
  showCreditsAllowance = false,
  hideRateLimitFields = false,
  canManage = true,
}: Props) {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [templates, setTemplates] = useState<PlanQuotaTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templateLoadFailed, setTemplateLoadFailed] = useState(false);

  useEffect(() => {
    form.setFieldsValue(plan);
  }, [form, plan]);

  useEffect(() => {
    let cancelled = false;
    async function loadTemplates() {
      setLoadingTemplates(true);
      setTemplateLoadFailed(false);
      try {
        const templates = await quotaTemplateApi.listAll({ isActive: true });
        if (!cancelled) setTemplates(templates);
      } catch (error: unknown) {
        warnNonCritical('PlanDetail quota templates preload', error);
        if (!cancelled) {
          setTemplates([]);
          setTemplateLoadFailed(true);
        }
      } finally {
        if (!cancelled) setLoadingTemplates(false);
      }
    }
    loadTemplates();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedTemplateIds = plan.quotaTemplateIds || [];
  const templateById = useMemo(
    () => new Map(templates.map((template) => [template.id, template])),
    [templates],
  );
  const selectedTemplates = selectedTemplateIds
    .map((templateId) => templateById.get(templateId))
    .filter((template): template is PlanQuotaTemplate => Boolean(template));
  // 模板列表只拉 isActive=true：已绑定但解析不到的 id = 模板已停用/删除，其规则不会下发
  const unresolvedTemplateCount = loadingTemplates || templateLoadFailed
    ? 0
    : selectedTemplateIds.length - selectedTemplates.length;

  // 用户侧权益预览：合并所选模板规则（同 (metric,windowType,durationSec) 取更小上限），
  // 口径与 billing 仓 resolvePlanQuotaRuleViews / publisher 下发一致
  const mergedRules = useMemo(() => {
    const byKey = new Map<string, QuotaRule>();
    for (const template of selectedTemplates) {
      for (const rule of template.rules) {
        const key = `${rule.metric}:${rule.windowType}:${rule.durationSec}`;
        const existing = byKey.get(key);
        if (!existing || rule.limitValue < existing.limitValue) {
          byKey.set(key, rule);
        }
      }
    }
    return [...byKey.values()];
  }, [selectedTemplates]);

  // 配额一致性守卫（me/quota-window-monthly-consistency.md，B2）：CREDITS 滚动窗口预算必须
  // ≤ 月度积分，且短窗 ≤ 长窗。仅自营套餐（showCreditsAllowance）校验；与 billing 后端硬拒同口径，
  // 后端为权威，此处仅即时提示。
  const creditWindowIssues = useMemo(() => {
    if (!showCreditsAllowance) return [];
    const monthly = typeof plan.monthlyCredits === 'number' ? plan.monthlyCredits : 0;
    const credits = mergedRules
      .filter((rule) => rule.windowType === 'ROLLING' && rule.metric === 'CREDITS')
      .sort((a, b) => a.durationSec - b.durationSec);
    const issues: string[] = [];
    if (monthly > 0) {
      for (const rule of credits) {
        if (rule.limitValue > monthly) {
          issues.push(
            `${windowText(rule.durationSec)}积分上限 ${rule.limitValue.toLocaleString()} 超过月度积分 ${monthly.toLocaleString()}`,
          );
        }
      }
    }
    for (let i = 1; i < credits.length; i += 1) {
      const shorter = credits[i - 1];
      const longer = credits[i];
      if (shorter.limitValue > longer.limitValue) {
        issues.push(
          `${windowText(shorter.durationSec)}积分上限 ${shorter.limitValue.toLocaleString()} 高于更长窗口 ${windowText(longer.durationSec)}(${longer.limitValue.toLocaleString()})`,
        );
      }
    }
    return issues;
  }, [mergedRules, plan.monthlyCredits, showCreditsAllowance]);

  return (
    <div style={{ maxWidth: 920 }}>
      <Form
        form={form}
        layout="vertical"
        initialValues={plan}
        disabled={!canManage}
        onValuesChange={(_, values) => onChange({ ...plan, ...values })}
      >
        {showCreditsAllowance && (
          <Space size={24} align="start" wrap style={{ marginBottom: 8 }}>
            <Form.Item label="月度积分" name="monthlyCredits">
              <StableNumberInput min={0} precision={0} addonAfter="积分/月" style={{ width: 200 }} />
            </Form.Item>
            <Form.Item label="积分滚存" name="creditsRollover" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item label="结转月数" name="rolloverMaxMonths">
              <StableNumberInput min={0} precision={0} addonAfter="月" style={{ width: 160 }} />
            </Form.Item>
          </Space>
        )}
        {!hideRateLimitFields && (
          <Space size={24} align="start" wrap>
            <Form.Item label="每分钟请求数 (RPM)" name="rateLimitRpm">
              <StableNumberInput min={1} precision={0} addonAfter="次/分" style={{ width: 240 }} />
            </Form.Item>
            <Form.Item label="每分钟 Token (TPM)" name="rateLimitTpm">
              <StableNumberInput
                min={1000}
                precision={0}
                formatter={formatIntegerInput}
                parser={parseIntegerInput}
                addonAfter="token/分"
                style={{ width: 240 }}
              />
            </Form.Item>
            <Form.Item label="最大上下文窗口" name="maxContextWindow">
              <StableNumberInput
                min={1000}
                precision={0}
                formatter={formatIntegerInput}
                parser={parseIntegerInput}
                addonAfter="token"
                style={{ width: 240 }}
              />
            </Form.Item>
          </Space>
        )}
      </Form>

      <div
        style={{
          marginTop: hideRateLimitFields ? 8 : 20,
          padding: '16px 18px',
          border: '1px solid var(--border-soft)',
          borderRadius: 8,
          background: '#fff',
        }}
      >
        <div style={{ marginBottom: 12 }}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            配额模板
          </Typography.Title>
          <Text type="secondary">
            {hideRateLimitFields
              ? '套餐配额的唯一来源：保存时写入 PlanQuotaRule，网关按规则执行，用户端按规则展示。'
              : '保存套餐时写入 PlanQuotaRule，作为请求、Token 和积分上限的套餐级规则来源。'}
          </Text>
        </div>

        {templateLoadFailed && (
          <Alert
            type="warning"
            showIcon
            message="配额模板加载失败"
            description="基础限流仍可保存；模板绑定需要 billing 内部接口可用。"
            style={{ marginBottom: 12 }}
          />
        )}

        <Select
          mode="multiple"
          allowClear
          showSearch
          loading={loadingTemplates}
          disabled={!canManage}
          placeholder="选择配额模板"
          value={selectedTemplateIds}
          optionFilterProp="label"
          options={templates.map((template) => ({
            label: `${template.name} · ${template.rules.length} 条规则`,
            value: template.id,
          }))}
          onChange={(ids) => onChange({ ...plan, quotaTemplateIds: ids })}
          style={{ width: '100%' }}
        />

        {creditWindowIssues.length > 0 && (
          <Alert
            type="error"
            showIcon
            message="配额配置不一致，保存将被拒绝"
            description={(
              <div>
                <div>CREDITS 滚动窗口预算必须 ≤ 月度积分，且短窗 ≤ 长窗：</div>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {creditWindowIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
            style={{ marginTop: 12 }}
          />
        )}

        {templates.length === 0 && !loadingTemplates ? (
          <Alert
            type="info"
            showIcon
            message="还没有可用的配额模板"
            description="先到配额模板库创建模板，再回到套餐中绑定。"
            action={(
              <Button size="small" type="primary" onClick={() => navigate(QUOTA_TEMPLATE_ROUTE)}>
                去配额模板库
              </Button>
            )}
            style={{ marginTop: 12 }}
          />
        ) : null}

        {unresolvedTemplateCount > 0 && (
          <Alert
            type="warning"
            showIcon
            message={`有 ${unresolvedTemplateCount} 个已绑定模板不可用（已停用或删除）`}
            description="不可用模板的规则不会下发网关、也不会在用户端展示，请重新选择有效模板。"
            style={{ marginTop: 12 }}
          />
        )}

        {selectedTemplates.length > 0 && (
          <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
            {selectedTemplates.map((template) => (
              <div
                key={template.id}
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  padding: '12px 14px',
                  background: '#f9fafb',
                }}
              >
                <Space size={8} wrap style={{ marginBottom: 8 }}>
                  <Text strong>{template.name}</Text>
                  <Tag>{template.rules.length} 条规则</Tag>
                </Space>
                {template.description && (
                  <div style={{ marginBottom: 8 }}>
                    <Text type="secondary">{template.description}</Text>
                  </div>
                )}
                <Space size={[8, 8]} wrap>
                  {template.rules.map((rule, index) => (
                    <Tag key={`${template.id}-${index}`} color="blue">
                      {ruleText(rule)}
                    </Tag>
                  ))}
                </Space>
              </div>
            ))}
          </div>
        )}
      </div>

      {hideRateLimitFields && (
        <div
          style={{
            marginTop: 14,
            padding: '16px 18px',
            border: '1px solid var(--border-soft)',
            borderRadius: 8,
            background: '#fff',
          }}
        >
          <div style={{ marginBottom: 12 }}>
            <Typography.Title level={5} style={{ margin: 0 }}>
              用户侧权益预览
            </Typography.Title>
            <Text type="secondary">
              按所选模板合并后的套餐配额（限额按 API Key 维度计数）。标注「网关执行」的规则会真实下发；
              「暂仅展示」的规则用户端不显示，待网关口径放行后自动生效。
            </Text>
          </div>
          {mergedRules.length === 0 ? (
            <Alert
              type="info"
              showIcon
              message="未绑定配额模板"
              description="自营套餐上架前必须绑定至少一个配额模板；未绑定时用户端不展示限额信息。"
            />
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {mergedRules.map((rule) => {
                const enforced = isRuleEnforced(rule);
                return (
                  <Space key={`${rule.metric}:${rule.windowType}:${rule.durationSec}`} size={10} wrap>
                    <Tag color={enforced ? 'green' : 'default'}>
                      {enforced ? '✓ 网关执行' : '◷ 暂仅展示'}
                    </Tag>
                    <Text>
                      每个 Key {rule.windowType === 'ROLLING'
                        ? windowText(rule.durationSec)
                        : `${WINDOW_LABEL[rule.windowType] ?? rule.windowType} ${rule.durationLabel}`}
                      最多 <Text strong>{rule.limitValue.toLocaleString()}</Text>{' '}
                      {USER_METRIC_LABEL[rule.metric] ?? rule.metric}
                    </Text>
                  </Space>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
