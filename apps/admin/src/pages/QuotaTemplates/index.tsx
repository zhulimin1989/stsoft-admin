import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Spin, Switch, Tag, message } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import {
  PageHeader,
  StatCard,
  StatCardGroup,
  FilterBar,
  DataTable,
  EmptyPlaceholder,
  StableNumberInput,
} from '../../components/common';
import {
  quotaTemplateApi,
  type PlanQuotaTemplate,
  type QuotaRule,
} from '../../api/v2';
import {
  rollingQuotaGateApi,
  codingPlanMonthlyRefreshApi,
  selfopNegativeDeductApi,
  type RollingQuotaGateState,
  type SelfopNegativeDeductState,
} from '../../api/admin';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { usePermission } from '../../hooks/usePermission';

interface TemplateRefCount {
  count: number;
}

const METRIC_LABEL: Record<QuotaRule['metric'], string> = {
  REQUESTS: '请求数',
  INPUT_TOKENS: '输入 Token',
  OUTPUT_TOKENS: '输出 Token',
  TOTAL_TOKENS: '总 Token',
  CREDITS: '积分',
};

const WINDOW_LABEL: Record<QuotaRule['windowType'], string> = {
  ROLLING: '滚动窗口',
  FIXED_PERIOD: '固定周期',
  CUMULATIVE: '累计',
};

// quota-v2：对外只用「请求数 / 积分」执行，token 维度仅记录不下发（防 token 上限被推测）。
// 与网关/billing 的 enforced 谓词一致：仅 ROLLING + (REQUESTS|CREDITS) + 正窗口 才会被真实执行。
const ENFORCED_METRICS: ReadonlySet<QuotaRule['metric']> = new Set(['REQUESTS', 'CREDITS']);
function isMetricEnforced(metric: QuotaRule['metric']): boolean {
  return ENFORCED_METRICS.has(metric);
}

// 模板内单调（me/quota-window-monthly-consistency.md）：同一模板内 CREDITS 滚动窗口短窗 ≤ 长窗。
// 与 billing 后端 findCreditMonotonicViolations 同口径；月度封顶在套餐编辑页/绑定时校验，不在此。
function creditMonotonicIssues(rules: (RuleFormValue | undefined)[] | undefined): string[] {
  const credits = (rules ?? [])
    .filter(
      (r): r is RuleFormValue =>
        !!r &&
        r.metric === 'CREDITS' &&
        r.windowType === 'ROLLING' &&
        typeof r.durationSec === 'number' &&
        typeof r.limitValue === 'number',
    )
    .sort((a, b) => a.durationSec - b.durationSec);
  const issues: string[] = [];
  for (let i = 1; i < credits.length; i += 1) {
    const shorter = credits[i - 1];
    const longer = credits[i];
    if (shorter.limitValue > longer.limitValue) {
      const sLabel = shorter.durationLabel || `${shorter.durationSec}s`;
      const lLabel = longer.durationLabel || `${longer.durationSec}s`;
      issues.push(`${sLabel} 积分上限 ${shorter.limitValue} 高于更长窗口 ${lLabel}(${longer.limitValue})`);
    }
  }
  return issues;
}

// 常用时长快填：选中即自动填入「展示时长 + 窗口秒数」。
// 5h(18000)/7d(604800) 这类秒数手填易错，给运营常用预设。
const DURATION_PRESETS: { label: string; durationLabel: string; durationSec: number }[] = [
  { label: '每分钟', durationLabel: '每分钟', durationSec: 60 },
  { label: '每小时', durationLabel: '每小时', durationSec: 3600 },
  { label: '每 5 小时', durationLabel: '每 5 小时', durationSec: 18000 },
  { label: '每天', durationLabel: '每天', durationSec: 86400 },
  { label: '每 7 天', durationLabel: '每 7 天', durationSec: 604800 },
];

const DEFAULT_RULE: QuotaRule = {
  metric: 'REQUESTS',
  windowType: 'ROLLING',
  durationLabel: '每分钟',
  durationSec: 60,
  limitValue: 60,
};

interface RuleFormValue {
  metric: QuotaRule['metric'];
  windowType: QuotaRule['windowType'];
  durationLabel: string;
  durationSec: number;
  limitValue: number;
  modelGroupId?: string | null;
}

interface EditorFormValues {
  name: string;
  description?: string;
  isActive?: boolean;
  rules: RuleFormValue[];
}

/**
 * 开关状态读取失败的原因分类。
 *
 * 403「权限不足」与「billing 内网调用失败」必须分开报：前者重试永远不会成功，
 * 给一个「重试」按钮是误导。本页两张卡所需的读权限都是
 * `admin.page.coding_quota_templates.view` —— 注意权限隐含关系是**单向**的
 * （`admin.plans.view` ⇒ 该页面权限，反向不成立），所以只勾了细粒度页面权限的账号
 * 同样应当能读到；若这里真的收到 403，说明角色连页面查看权限都没有。
 */
interface SwitchLoadError {
  /** false 时不渲染「重试」按钮（重试不可能改变结果）。 */
  retryable: boolean;
  message: string;
  description: string;
}

function classifySwitchLoadError(err: unknown, subject: string): SwitchLoadError {
  const res = (err as { response?: { status?: number; data?: { message?: string } } })?.response;
  const status = res?.status;
  const serverMsg = res?.data?.message;
  if (status === 403) {
    return {
      retryable: false,
      message: '无权查看',
      description: `${serverMsg || '权限不足'} —— 读取${subject}需要「CodingPlan › 配额模板」的查看权限，请联系管理员为当前角色分配后再试。`,
    };
  }
  if (status === 401) {
    return { retryable: false, message: '登录状态已失效', description: '请重新登录后再查看。' };
  }
  return {
    retryable: true,
    message: `无法读取${subject}`,
    // 无服务端 message 时不能断言是 billing 那一跳失败：也可能 admin-api 不可达 / 超时 / 429。
    description: serverMsg || '开关服务暂不可用，请重试。',
  };
}

/** 保存失败提示：优先展示服务端原因（如 billing 硬门禁拒绝、权限不足）。 */
function showSwitchSaveError(err: unknown): void {
  const res = (err as { response?: { status?: number; data?: { message?: string } } })?.response;
  if (res?.status === 403) {
    message.error(
      `${res.data?.message || '权限不足'} —— 修改本开关需要「CodingPlan › 配额模板」的管理权限。`,
    );
    return;
  }
  message.error(res?.data?.message || '保存失败');
}

/**
 * 滚动配额 Gate 运行时开关（自营套餐配额执行）。
 * effectiveEnabled = env 强制开 || admin 覆盖开；env 强制开时锁定（不可关），但仍可「清除 Admin 覆盖」。
 * 不做乐观更新；GET 失败显错误态（不兜底为关）；PUT 成功后以返回的最新状态为准。
 */
function RollingQuotaGateCard() {
  const canManage = usePermission('admin.page.coding_quota_templates.manage');
  const [state, setState] = useState<RollingQuotaGateState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<SwitchLoadError | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setState(await rollingQuotaGateApi.get());
    } catch (err) {
      setLoadError(classifySwitchLoadError(err, 'Gate 状态'));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const apply = async (enabled: boolean | null, okMsg: string) => {
    if (saving) return;
    setSaving(true);
    try {
      setState(await rollingQuotaGateApi.set(enabled));
      message.success(okMsg);
    } catch (err) {
      showSwitchSaveError(err); // 展示服务端原因（权限不足 / 参数非法），不再一律「保存失败」
    } finally {
      setSaving(false);
    }
  };

  const title = <span>滚动配额 Gate <Tag color="blue">自营套餐</Tag></span>;

  if (loading) {
    return (
      <Card title={title} style={{ marginBottom: 16 }}>
        <Spin />
      </Card>
    );
  }
  if (loadError || !state) {
    const e = loadError ?? {
      retryable: true,
      message: '无法读取 Gate 状态',
      description: 'billing 内网调用失败，请重试。',
    };
    return (
      <Card title={title} style={{ marginBottom: 16 }}>
        <Alert
          type="error"
          showIcon
          message={e.message}
          description={e.description}
          action={
            e.retryable
              ? <Button size="small" onClick={() => void load()}>重试</Button>
              : undefined
          }
        />
      </Card>
    );
  }

  const { effectiveEnabled, envForced, adminEnabled } = state;
  const row = (k: ReactNode, v: ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
      <span style={{ color: '#00000073' }}>{k}</span>
      <span>{v}</span>
    </div>
  );

  return (
    <Card title={title} style={{ marginBottom: 16 }}>
      <div style={{ maxWidth: 520 }}>
        {row('生效状态（计费/网关实际口径）',
          effectiveEnabled ? <Tag color="success">已开启</Tag> : <Tag color="error">已关闭</Tag>)}
        {row('环境变量强制（BILLING_ROLLING_QUOTA_GATE_ENABLED）',
          envForced ? <Tag color="gold">是</Tag> : <Tag>否</Tag>)}
        {row('Admin 覆盖',
          adminEnabled === null
            ? <Tag>继承</Tag>
            : adminEnabled
              ? <Tag color="processing">开启</Tag>
              : <Tag>关闭</Tag>)}
      </div>
      <Space style={{ marginTop: 16 }} size="large">
        <Space>
          <Switch
            checked={effectiveEnabled}
            disabled={!canManage || envForced || saving}
            loading={saving}
            onChange={(checked) => void apply(checked, checked ? '滚动配额 Gate 已开启' : '滚动配额 Gate 已关闭')}
          />
          <span style={{ color: '#00000073', fontSize: 12 }}>
            {envForced ? '环境变量已强制开启，无法在此关闭' : '开关仅影响自营套餐滚动配额执行'}
          </span>
        </Space>
        {canManage && adminEnabled !== null && (
          <Button size="small" disabled={saving} onClick={() => void apply(null, '已清除 Admin 覆盖（继承环境变量）')}>
            清除 Admin 覆盖
          </Button>
        )}
      </Space>
      <Alert
        style={{ marginTop: 16 }}
        type="info"
        showIcon
        message="开关仅作用于自营套餐（coding_plan_entitlement，非转售）。请求前硬阻断还依赖网关消费 has_balance。"
      />
    </Card>
  );
}

/**
 * 终态负额结算（R6）+ 月度补发（R3b）联动开关卡。
 * 依赖纪律（billing 侧硬门禁，前端仅提示）：负额结算必须在月度补发已生效后才能开启；
 * 月度补发在负额结算仍开时不可关闭。另一前提=网关终态结算 env（部署层，只读展示）。
 */
function SelfopNegativeSettlementCard() {
  // 与同页 Gate 卡及 admin-api/billing 侧一致用配额模板页权限。
  // 早期误用 admin.plans.manage：隐含关系单向（admin.plans.manage ⇒ coding_quota_templates.manage，
  // 反向不成立），会让只勾细粒度页面权限的账号把开关看成只读。
  const canManage = usePermission('admin.page.coding_quota_templates.manage');
  const [refresh, setRefresh] = useState<RollingQuotaGateState | null>(null);
  const [negative, setNegative] = useState<SelfopNegativeDeductState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<SwitchLoadError | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // 用 allSettled 而非 all：两个请求可能以不同原因失败（一个 403、另一个 502），
      // Promise.all 只给最先 reject 的那个 ⇒ 展示哪条取决于竞速，诊断随机。
      // 这里按「登录失效 > 无权限 > 其它」定优先级，稳定选出最该告诉用户的那条。
      const [rr, nr] = await Promise.allSettled([
        codingPlanMonthlyRefreshApi.get(),
        selfopNegativeDeductApi.get(),
      ]);
      const failures = [rr, nr].filter(
        (x): x is PromiseRejectedResult => x.status === 'rejected',
      );
      if (failures.length > 0) {
        const statusOf = (e: unknown) =>
          (e as { response?: { status?: number } })?.response?.status;
        const rank = (e: unknown) => (statusOf(e) === 401 ? 0 : statusOf(e) === 403 ? 1 : 2);
        const worst = failures.reduce((a, b) => (rank(a.reason) <= rank(b.reason) ? a : b));
        setLoadError(classifySwitchLoadError(worst.reason, '开关状态'));
        return;
      }
      setRefresh((rr as PromiseFulfilledResult<RollingQuotaGateState>).value);
      setNegative((nr as PromiseFulfilledResult<SelfopNegativeDeductState>).value);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const applyRefresh = async (enabled: boolean | null, okMsg: string): Promise<boolean> => {
    if (saving) return false;
    setSaving(true);
    try {
      setRefresh(await codingPlanMonthlyRefreshApi.set(enabled));
      message.success(okMsg);
      return true;
    } catch (err) {
      showSwitchSaveError(err); // billing 硬门禁拒绝时展示服务端原因（如负额结算仍开）
      return false;
    } finally {
      setSaving(false);
    }
  };

  const applyNegative = async (enabled: boolean | null, okMsg: string): Promise<boolean> => {
    if (saving) return false;
    setSaving(true);
    try {
      setNegative(await selfopNegativeDeductApi.set(enabled));
      message.success(okMsg);
      return true;
    } catch (err) {
      showSwitchSaveError(err); // billing 硬门禁拒绝时展示服务端原因（如月度补发未开）
      return false;
    } finally {
      setSaving(false);
    }
  };

  const title = <span>终态负额结算（R6）+ 月度补发 <Tag color="blue">自营套餐</Tag></span>;

  if (loading) {
    return (
      <Card title={title} style={{ marginBottom: 16 }}>
        <Spin />
      </Card>
    );
  }
  if (loadError || !refresh || !negative) {
    const e = loadError ?? {
      retryable: true,
      message: '无法读取开关状态',
      description: 'billing 内网调用失败，请重试。',
    };
    return (
      <Card title={title} style={{ marginBottom: 16 }}>
        <Alert
          type="error"
          showIcon
          message={e.message}
          description={e.description}
          action={
            e.retryable
              ? <Button size="small" onClick={() => void load()}>重试</Button>
              : undefined
          }
        />
      </Card>
    );
  }

  const row = (k: ReactNode, v: ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
      <span style={{ color: '#00000073' }}>{k}</span>
      <span>{v}</span>
    </div>
  );
  const stateTag = (s: RollingQuotaGateState) =>
    s.effectiveEnabled ? <Tag color="success">已开启</Tag> : <Tag color="error">已关闭</Tag>;
  const overrideTag = (s: RollingQuotaGateState) =>
    s.adminEnabled === null ? <Tag>继承</Tag> : s.adminEnabled ? <Tag color="processing">开启</Tag> : <Tag>关闭</Tag>;

  return (
    <Card title={title} style={{ marginBottom: 16 }}>
      <div style={{ maxWidth: 560 }}>
        {row('① 月度补发（每小时扫描，按月补发/清欠）', stateTag(refresh))}
        {row('　 Admin 覆盖', overrideTag(refresh))}
        {row('② 终态负额结算（已交付末笔可跨零入账）', stateTag(negative))}
        {row('　 Admin 覆盖', overrideTag(negative))}
        {row('网关终态结算 env（BILLING_GATEWAY_USAGE_ALLOW_NEGATIVE_BALANCE，部署层）',
          negative.gatewayNegativeEnv ? <Tag color="gold">已开</Tag> : <Tag color="warning">未开</Tag>)}
      </div>
      <Space style={{ marginTop: 16 }} size="large" wrap>
        <Space>
          <Switch
            checked={refresh.effectiveEnabled}
            disabled={!canManage || refresh.envForced || saving}
            loading={saving}
            onChange={(checked) => void applyRefresh(checked, checked ? '月度补发已开启' : '月度补发已关闭')}
          />
          <span style={{ color: '#00000073', fontSize: 12 }}>月度补发</span>
        </Space>
        <Space>
          <Switch
            checked={negative.effectiveEnabled}
            disabled={!canManage || negative.envForced || saving}
            loading={saving}
            onChange={(checked) => void applyNegative(checked, checked ? '终态负额结算已开启' : '终态负额结算已关闭')}
          />
          <span style={{ color: '#00000073', fontSize: 12 }}>终态负额结算</span>
        </Space>
        {canManage && (refresh.adminEnabled !== null || negative.adminEnabled !== null) && (
          <Button
            size="small"
            disabled={saving}
            onClick={() => {
              // 清除顺序遵守依赖：先清负额（②）再清月度（①）；第一步失败即中止（codex Low 修复）。
              void (async () => {
                if (negative.adminEnabled !== null) {
                  const ok = await applyNegative(null, '已清除负额结算 Admin 覆盖');
                  if (!ok) return;
                }
                if (refresh.adminEnabled !== null) await applyRefresh(null, '已清除月度补发 Admin 覆盖');
              })();
            }}
          >
            清除 Admin 覆盖
          </Button>
        )}
      </Space>
      <Alert
        style={{ marginTop: 16 }}
        type="info"
        showIcon
        message="开启顺序（billing 强制）：先开①月度补发并确认运行，再开②终态负额结算；关闭反序。三前提齐备（①+②+网关 env）负额结算才实际生效。仅作用于自营套餐（platform_model_package），转售/通用订阅/按量付费不受影响。"
      />
    </Card>
  );
}

export default function QuotaTemplatesPage() {
  const canManage = usePermission('admin.page.coding_quota_templates.manage');
  const [search, setSearch] = useState('');
  const [activeTpl, setActiveTpl] = useState<PlanQuotaTemplate | null>(null);
  const [activeRefs, setActiveRefs] = useState<TemplateRefCount | null>(null);
  const [refsLoading, setRefsLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editorForm] = Form.useForm<EditorFormValues>();
  // 模板内单调即时守卫：监听规则变化，违规则禁存 + 即时提示（后端为权威硬拒）。
  const watchedRules = Form.useWatch('rules', editorForm);
  const monotonicIssues = useMemo(() => creditMonotonicIssues(watchedRules), [watchedRules]);

  const quotaTemplates = usePaginatedList<PlanQuotaTemplate>({
    pageSize: 20,
    deps: [search],
    onError: () => message.error('加载配额模板失败'),
    fetcher: useCallback(async ({ page, pageSize }) => {
      const res = await quotaTemplateApi.list({
        page,
        pageSize,
        search: search || undefined,
      });
      return {
        items: res.items || [],
        total: res.total || 0,
        page,
        pageSize,
      };
    }, [search]),
  });

  const stats = useMemo(() => {
    const items = quotaTemplates.items;
    const total = quotaTemplates.total;
    const top = [...items].sort(
      (a, b) =>
        (b.referencedPlanIds?.length ?? 0) - (a.referencedPlanIds?.length ?? 0),
    )[0];
    const avg =
      items.length > 0
        ? Math.round(
            items.reduce(
              (acc, t) => acc + (t.referencedPlanIds?.length ?? 0),
              0,
            ) / total,
          )
        : 0;
    return {
      total,
      topName: top?.name ?? '—',
      avg,
    };
  }, [quotaTemplates.items, quotaTemplates.total]);

  const handleCopy = async (tpl: PlanQuotaTemplate) => {
    try {
      await quotaTemplateApi.clone(tpl.id);
      message.success('已复制');
      quotaTemplates.reload();
    } catch {
      message.error('复制失败');
    }
  };

  const handleDelete = async (tpl: PlanQuotaTemplate) => {
    try {
      await quotaTemplateApi.delete(tpl.id);
      message.success('已删除');
      quotaTemplates.reload();
    } catch {
      message.error('删除失败');
    }
  };

  const openCreate = () => {
    setEditingId(null);
    editorForm.resetFields();
    editorForm.setFieldsValue({ isActive: true, rules: [{ ...DEFAULT_RULE }] });
    setEditorOpen(true);
  };

  const openEdit = (tpl: PlanQuotaTemplate) => {
    setActiveTpl(null);
    setActiveRefs(null);
    setEditingId(tpl.id);
    editorForm.resetFields();
    editorForm.setFieldsValue({
      name: tpl.name,
      description: tpl.description,
      isActive: tpl.isActive,
      rules: (tpl.rules ?? []).map((r) => ({
        metric: r.metric,
        windowType: r.windowType,
        durationLabel: r.durationLabel,
        durationSec: r.durationSec,
        limitValue: r.limitValue,
        modelGroupId: r.modelGroupId ?? undefined,
      })),
    });
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditingId(null);
    editorForm.resetFields();
  };

  const handleSave = async () => {
    let values: EditorFormValues;
    try {
      values = await editorForm.validateFields();
    } catch {
      return; // 校验失败，AntD 已高亮
    }
    // 本地兜底（不只靠按钮 disabled）：防快捷键/其它入口绕过。后端仍为权威硬拒。
    const issues = creditMonotonicIssues(values.rules);
    if (issues.length > 0) {
      message.error(`模板规则不一致：${issues[0]}。同一模板内 CREDITS 滚动窗口短窗预算必须 ≤ 长窗。`);
      return;
    }
    const payload: Partial<PlanQuotaTemplate> = {
      name: values.name,
      description: values.description ?? '',
      isActive: values.isActive ?? true,
      rules: (values.rules ?? []).map((r) => ({
        metric: r.metric,
        windowType: r.windowType,
        durationLabel: r.durationLabel,
        durationSec: r.durationSec,
        limitValue: r.limitValue,
        ...(r.modelGroupId ? { modelGroupId: r.modelGroupId } : {}),
      })),
    };
    setSaving(true);
    try {
      if (editingId) {
        await quotaTemplateApi.update(editingId, payload);
        message.success('模板已更新');
      } else {
        await quotaTemplateApi.create(payload);
        message.success('模板已创建');
      }
      closeEditor();
      quotaTemplates.reload();
    } catch (err) {
      // 后端为权威：把 400 一致性等具体原因透出，而非笼统「创建失败」。
      // NestJS message 可能是 string 或 string[]，两者都兼容。
      const raw = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
      const backendMsg = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.join('；') : undefined;
      message.error(backendMsg || (editingId ? '更新失败' : '创建失败'));
    } finally {
      setSaving(false);
    }
  };

  const openDetail = async (tpl: PlanQuotaTemplate) => {
    setActiveTpl(tpl);
    setActiveRefs(null);
    setRefsLoading(true);
    try {
      const refs = await quotaTemplateApi.references(tpl.id);
      setActiveRefs({ count: refs.count });
    } catch {
      setActiveRefs({ count: 0 });
    } finally {
      setRefsLoading(false);
    }
  };

  const closeDetail = () => {
    setActiveTpl(null);
    setActiveRefs(null);
  };

  const columns = [
    {
      title: '模板名',
      dataIndex: 'name',
      key: 'name',
      render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span>,
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      render: (v: string) =>
        v ? (
          <span>{v}</span>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        ),
    },
    {
      title: '规则数',
      key: 'ruleCount',
      width: 90,
      render: (_: unknown, r: PlanQuotaTemplate) => r.rules?.length ?? 0,
    },
    {
      title: '被引用 plan 数',
      key: 'refs',
      width: 130,
      render: (_: unknown, r: PlanQuotaTemplate) =>
        r.referencedPlanIds?.length ?? 0,
    },
    {
      title: '创建时间',
      key: 'createdAt',
      width: 180,
      render: (_: unknown, r: PlanQuotaTemplate) =>
        r.createdAt ? new Date(r.createdAt).toLocaleString('zh-CN') : '—',
    },
    {
      title: '操作',
      key: 'actions',
      width: 260,
      align: 'right' as const,
      render: (_: unknown, r: PlanQuotaTemplate) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => openDetail(r)}>
            详情
          </Button>
          <Button type="link" size="small" disabled={!canManage} onClick={() => openEdit(r)}>
            编辑
          </Button>
          <Button type="link" size="small" disabled={!canManage} onClick={() => handleCopy(r)}>
            复制
          </Button>
          <Popconfirm
            title="确认删除此模板？被引用 plan 将失去关联。"
            onConfirm={() => handleDelete(r)}
          >
            <Button type="link" size="small" danger disabled={!canManage}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="配额模板"
        subtitle="CodingPlan 套餐的请求、Token 与积分上限模板"
        actions={[
          <Button
            key="new"
            type="primary"
            icon={<PlusOutlined />}
            disabled={!canManage}
            onClick={openCreate}
          >
            新建模板
          </Button>,
        ]}
      />

      <RollingQuotaGateCard />
      <SelfopNegativeSettlementCard />

      <StatCardGroup columns={3}>
        <StatCard label="模板数" value={stats.total} />
        <StatCard label="本页引用最多模板" value={stats.topName} />
        <StatCard label="本页平均被引用数" value={stats.avg} />
      </StatCardGroup>

      <FilterBar
        search={{
          placeholder: '搜索模板名 / 描述',
          onSearch: (v) => {
            setSearch(v);
          },
        }}
      />

      {quotaTemplates.items.length === 0 && !quotaTemplates.loading ? (
        <EmptyPlaceholder
          title="暂无配额模板"
          description="尚未创建任何配额模板。点击右上角新建。"
        />
      ) : (
        <DataTable<PlanQuotaTemplate>
          columns={columns}
          dataSource={quotaTemplates.items}
          rowKey="id"
          loading={quotaTemplates.loading}
          listPagination={quotaTemplates.tablePagination}
          scroll={{ x: 960 }}
        />
      )}

      <Modal
        title={activeTpl?.name ?? '配额模板详情'}
        open={!!activeTpl}
        onCancel={closeDetail}
        footer={
          activeTpl
            ? [
                <Button key="close" onClick={closeDetail}>
                  关闭
                </Button>,
                <Button key="edit" type="primary" disabled={!canManage} onClick={() => openEdit(activeTpl)}>
                  编辑
                </Button>,
              ]
            : null
        }
        width={680}
        destroyOnClose
      >
        {activeTpl && (
          <div>
            <div style={{ marginBottom: 16, color: 'var(--text-muted)' }}>
              {activeTpl.description || '（暂无描述）'}
            </div>

            <div
              style={{
                marginBottom: 12,
                padding: '8px 12px',
                background: 'var(--bg-subtle, #f5f5f5)',
                borderRadius: 6,
                fontSize: 13,
              }}
            >
              被引用 plan 数:{' '}
              {refsLoading
                ? '加载中…'
                : (activeRefs?.count ?? 0).toLocaleString()}
            </div>

            <div style={{ marginBottom: 8, fontWeight: 500 }}>
              规则列表（{activeTpl.rules?.length ?? 0} 条）
            </div>
            {activeTpl.rules && activeTpl.rules.length > 0 ? (
              <div
                style={{
                  border: '1px solid var(--border, #e5e7eb)',
                  borderRadius: 6,
                  overflow: 'hidden',
                }}
              >
                {activeTpl.rules.map((rule, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '10px 12px',
                      borderBottom:
                        i < activeTpl.rules.length - 1
                          ? '1px solid var(--border, #e5e7eb)'
                          : 'none',
                      fontSize: 13,
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr 1fr 1fr',
                      gap: 8,
                    }}
                  >
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                        指标
                      </div>
                      <div>
                        {METRIC_LABEL[rule.metric] ?? rule.metric}
                        {isMetricEnforced(rule.metric) ? null : (
                          <Tag color="warning" style={{ marginLeft: 6 }}>
                            不生效
                          </Tag>
                        )}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                        窗口
                      </div>
                      <div>
                        {WINDOW_LABEL[rule.windowType] ?? rule.windowType}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                        时长
                      </div>
                      <div>{rule.durationLabel}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                        上限
                      </div>
                      <div>{rule.limitValue.toLocaleString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyPlaceholder
                title="暂无规则"
                description="此模板未配置任何配额规则。"
              />
            )}
          </div>
        )}
      </Modal>

      <Modal
        title={editingId ? '编辑配额模板' : '新建配额模板'}
        open={editorOpen}
        onCancel={closeEditor}
        onOk={handleSave}
        okText={editingId ? '保存' : '创建'}
        okButtonProps={{ disabled: !canManage || monotonicIssues.length > 0 }}
        cancelText="取消"
        confirmLoading={saving}
        width={920}
        destroyOnClose
      >
        <Form form={editorForm} layout="vertical" disabled={!canManage}>
          <Form.Item label="模板名" name="name" rules={[{ required: true, message: '请输入模板名' }]}>
            <Input placeholder="如：Coding Pro 默认配额" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={2} placeholder="说明此模板适用的套餐或场景" />
          </Form.Item>
          <Form.Item label="启用" name="isActive" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="配额口径（quota-v2）"
            description={
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                仅「请求数 / 积分」+「滚动窗口」会被网关真实执行；Token 维度仅作记录、不下发执行（防 token 上限被推测）。
              </div>
            }
          />
          {monotonicIssues.length > 0 && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 12 }}
              message="模板规则不一致，保存将被拒绝"
              description={(
                <div>
                  <div>同一模板内 CREDITS 滚动窗口短窗预算必须 ≤ 长窗：</div>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {monotonicIssues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </div>
              )}
            />
          )}
          <div style={{ fontWeight: 500, marginBottom: 12 }}>配额规则</div>
          <Form.List
            name="rules"
            rules={[
              {
                validator: async (_, rules: RuleFormValue[]) => {
                  if (!rules || rules.length < 1) {
                    return Promise.reject(new Error('至少配置一条规则'));
                  }
                },
              },
            ]}
          >
            {(fields, { add, remove }, { errors }) => (
              <>
                {fields.map((field) => (
                  <div
                    key={field.key}
                    style={{
                      border: '1px solid var(--border-soft, #e5e7eb)',
                      borderRadius: 8,
                      padding: 12,
                      marginBottom: 12,
                      background: 'var(--bg-panel, #fafafa)',
                    }}
                  >
                    <Space size={12} align="baseline" style={{ display: 'flex', flexWrap: 'wrap' }}>
                      <Form.Item
                        name={[field.name, 'metric']}
                        label="指标"
                        rules={[{ required: true, message: '必选' }]}
                        style={{ width: 140 }}
                      >
                        <Select
                          options={Object.entries(METRIC_LABEL).map(([value, label]) => ({
                            value,
                            label: isMetricEnforced(value as QuotaRule['metric'])
                              ? label
                              : `${label}（不生效）`,
                          }))}
                        />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'windowType']}
                        label="窗口类型"
                        rules={[{ required: true, message: '必选' }]}
                        style={{ width: 130 }}
                      >
                        <Select
                          options={Object.entries(WINDOW_LABEL).map(([value, label]) => ({ value, label }))}
                        />
                      </Form.Item>
                      <div style={{ width: 120 }}>
                        <div style={{ fontSize: 14, lineHeight: '22px', marginBottom: 8 }}>常用时长</div>
                        <Select
                          placeholder="快填"
                          allowClear
                          style={{ width: '100%' }}
                          options={DURATION_PRESETS.map((p) => ({ value: p.label, label: p.label }))}
                          onChange={(label) => {
                            const preset = DURATION_PRESETS.find((p) => p.label === label);
                            if (preset) {
                              editorForm.setFieldValue(['rules', field.name, 'durationLabel'], preset.durationLabel);
                              editorForm.setFieldValue(['rules', field.name, 'durationSec'], preset.durationSec);
                            }
                          }}
                        />
                      </div>
                      <Form.Item
                        name={[field.name, 'durationLabel']}
                        label="展示时长"
                        rules={[{ required: true, message: '必填' }]}
                        style={{ width: 130 }}
                      >
                        <Input placeholder="如 每 5 小时" />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'durationSec']}
                        label="窗口秒数"
                        rules={[{ required: true, type: 'number', min: 1, message: '> 0' }]}
                        style={{ width: 120 }}
                      >
                        <StableNumberInput min={1} precision={0} style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'limitValue']}
                        label="上限"
                        rules={[{ required: true, type: 'number', min: 1, message: '> 0' }]}
                        style={{ width: 150 }}
                      >
                        <StableNumberInput min={1} precision={0} style={{ width: '100%' }} />
                      </Form.Item>
                      <Button
                        danger
                        type="link"
                        icon={<DeleteOutlined />}
                        onClick={() => remove(field.name)}
                        disabled={!canManage || fields.length <= 1}
                      >
                        删除
                      </Button>
                    </Space>
                    <Form.Item
                      noStyle
                      shouldUpdate={(prev, cur) =>
                        prev?.rules?.[field.name]?.metric !== cur?.rules?.[field.name]?.metric
                      }
                    >
                      {() => {
                        const m = editorForm.getFieldValue([
                          'rules',
                          field.name,
                          'metric',
                        ]) as QuotaRule['metric'];
                        return isMetricEnforced(m) ? null : (
                          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--warning, #d46b08)' }}>
                            Token 维度不会被网关执行（quota-v2 对外只用 请求数 / 积分）；如需削峰请改用「积分」。
                          </div>
                        );
                      }}
                    </Form.Item>
                  </div>
                ))}
                <Button
                  type="dashed"
                  block
                  icon={<PlusOutlined />}
                  disabled={!canManage}
                  onClick={() => add({ ...DEFAULT_RULE })}
                >
                  添加规则
                </Button>
                <Form.ErrorList errors={errors} />
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
    </div>
  );
}
