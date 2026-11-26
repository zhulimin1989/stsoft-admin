import { useEffect, useMemo, useState } from 'react';
import {
  Tabs,
  Button,
  Modal,
  Form,
  Input,
  Select,
  DatePicker,
  Switch,
  Popconfirm,
  Checkbox,
  Tooltip,
  message,
} from 'antd';
import { PlusOutlined, WarningOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
  PageHeader,
  DataTable,
  StableNumberInput,
  Tag,
  type TagVariant,
} from '../../components/common';
import {
  riskRuleApi,
  type RiskAction,
  type RiskListType,
  type RiskRule,
  type RiskRuleType,
  type RiskListEntry,
} from '../../api/v2';
import { usePermission } from '../../hooks/usePermission';

dayjs.extend(relativeTime);

const LIST_TYPE_OPTIONS: { value: RiskListType; label: string }[] = [
  { value: 'EMAIL', label: 'EMAIL' },
  { value: 'DOMAIN', label: 'DOMAIN' },
  { value: 'IP', label: 'IP' },
  { value: 'CARD_HASH', label: 'CARD_HASH' },
  { value: 'USER_ID', label: 'USER_ID' },
];

const ACTION_OPTIONS: { value: RiskAction; label: string }[] = [
  { value: 'BLOCK', label: '阻止' },
  { value: 'ALERT', label: '告警' },
  { value: 'DISABLE_KEY', label: '停 Key' },
  { value: 'FREEZE_USER', label: '冻结用户' },
];

const ACTION_LABEL: Record<RiskAction, string> = {
  BLOCK: '阻止',
  ALERT: '告警',
  DISABLE_KEY: '停 Key',
  FREEZE_USER: '冻结用户',
};

const LIST_TYPE_VARIANT: Record<RiskListType, TagVariant> = {
  EMAIL: 'muted',
  DOMAIN: 'muted',
  IP: 'muted',
  CARD_HASH: 'warn',
  USER_ID: 'muted',
};

const DANGEROUS_ACTIONS: ReadonlySet<RiskAction> = new Set<RiskAction>([
  'BLOCK',
  'FREEZE_USER',
  'DISABLE_KEY',
]);

/**
 * BLACKLIST + BLOCK rules: backend records hits but no caller has wired
 * `isUserBlocked()` into request paths yet. Surface that to operators so
 * they don't believe a real-time block is in effect.
 */
function NotWiredBadge() {
  return (
    <Tooltip title="此规则记录命中但当前未真实拦截请求，待 API gateway 集成">
      <span style={{ marginLeft: 6 }}>
        <Tag variant="warn">
          <WarningOutlined style={{ marginRight: 4 }} />
          未接入实时检查
        </Tag>
      </span>
    </Tooltip>
  );
}

interface BlacklistTabProps {
  refreshKey: number;
}

function BlacklistTab({ refreshKey }: BlacklistTabProps) {
  const canManage = usePermission('admin.page.risk_rules.manage');
  const [items, setItems] = useState<RiskListEntry[]>([]);
  const [rules, setRules] = useState<RiskRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const fetch = async () => {
    setLoading(true);
    try {
      const [entriesRes, rulesRes] = await Promise.all([
        riskRuleApi.listEntries({}),
        riskRuleApi.listRules({ ruleType: 'BLACKLIST' }),
      ]);
      setItems(entriesRes.items ?? []);
      setRules(rulesRes.items ?? []);
    } catch {
      message.error('加载黑名单失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetch();
  }, [refreshKey]);

  const ruleColumns = [
    {
      title: '规则名',
      key: 'name',
      render: (_: unknown, r: RiskRule) => (
        <span>
          {r.name}
          {r.action === 'BLOCK' && <NotWiredBadge />}
        </span>
      ),
    },
    {
      title: '匹配类型',
      key: 'matchTypes',
      render: (_: unknown, r: RiskRule) => {
        const cfg = r.config as { matchTypes?: string[] };
        return (cfg.matchTypes ?? []).join(', ') || '—';
      },
    },
    {
      title: '动作',
      key: 'action',
      width: 110,
      render: (_: unknown, r: RiskRule) => (
        <Tag variant={r.action === 'BLOCK' ? 'warn' : 'muted'}>
          {ACTION_LABEL[r.action]}
        </Tag>
      ),
    },
    {
      title: '启停',
      key: 'isActive',
      width: 90,
      render: (_: unknown, r: RiskRule) => (
        <Tag variant={r.isActive ? 'success' : 'muted'}>
          {r.isActive ? '已启用' : '已停用'}
        </Tag>
      ),
    },
    {
      title: '触发计数',
      key: 'triggerCount',
      width: 90,
      render: (_: unknown, r: RiskRule) => r.triggerCount,
    },
  ];

  const handleAdd = async () => {
    const v = await form.validateFields();
    try {
      await riskRuleApi.addEntry({
        listType: v.listType,
        value: v.value,
        reason: v.reason,
        expiresAt: v.expiresAt
          ? (v.expiresAt as dayjs.Dayjs).toISOString()
          : undefined,
      });
      message.success('已添加');
      setOpen(false);
      form.resetFields();
      fetch();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? '添加失败';
      message.error(msg);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await riskRuleApi.removeEntry(id);
      message.success('已移除');
      fetch();
    } catch {
      message.error('移除失败');
    }
  };

  const columns = [
    {
      title: '类型',
      key: 'listType',
      width: 110,
      render: (_: unknown, r: RiskListEntry) => (
        <Tag variant={LIST_TYPE_VARIANT[r.listType]}>{r.listType}</Tag>
      ),
    },
    {
      title: '值',
      dataIndex: 'value',
      key: 'value',
      ellipsis: true,
    },
    {
      title: '添加原因',
      dataIndex: 'reason',
      key: 'reason',
      ellipsis: true,
    },
    {
      title: '添加人',
      dataIndex: 'addedBy',
      key: 'addedBy',
      width: 140,
    },
    {
      title: '失效时间',
      key: 'expiresAt',
      width: 140,
      render: (_: unknown, r: RiskListEntry) =>
        r.expiresAt ? dayjs(r.expiresAt).format('YYYY-MM-DD') : '永久',
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      align: 'right' as const,
      render: (_: unknown, r: RiskListEntry) => (
        <Popconfirm title="确认移除？" onConfirm={() => handleRemove(r.id)}>
          <Button size="small" type="link" danger disabled={!canManage}>
            移除
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      {rules.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h4 style={{ marginBottom: 8 }}>BLACKLIST 规则</h4>
          <DataTable<RiskRule>
            columns={ruleColumns}
            dataSource={rules}
            rowKey="id"
            loading={loading}
            searchable
            searchPlaceholder="搜索规则 / 模型"
            pagination={false}
            scroll={{ x: 800 }}
          />
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 12,
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h4 style={{ margin: 0 }}>名单条目</h4>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!canManage}
          onClick={() => setOpen(true)}
        >
          添加
        </Button>
      </div>

      <DataTable<RiskListEntry>
        columns={columns}
        dataSource={items}
        rowKey="id"
        loading={loading}
        searchable
        searchPlaceholder="搜索用户 / 标识"
        pagination={false}
        scroll={{ x: 900 }}
      />

      <Modal
        title="添加黑名单"
        open={open}
        onOk={handleAdd}
        onCancel={() => setOpen(false)}
        destroyOnClose
        okText="添加"
        okButtonProps={{ disabled: !canManage }}
      >
        <Form form={form} layout="vertical" disabled={!canManage}>
          <Form.Item
            name="listType"
            label="类型"
            rules={[{ required: true }]}
          >
            <Select options={LIST_TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item name="value" label="值" rules={[{ required: true }]}>
            <Input placeholder="如 evil@example.com / 1.2.3.4" />
          </Form.Item>
          <Form.Item
            name="reason"
            label="添加原因"
            rules={[{ required: true }]}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="expiresAt" label="失效时间(可选)">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

interface RuleTabProps {
  ruleType: RiskRuleType;
  newButtonLabel: string;
  refreshKey: number;
  description: (rule: RiskRule) => string;
  buildConfig: (formValues: Record<string, unknown>) => Record<string, unknown>;
  formContent: () => React.ReactNode;
}

function RuleTab({
  ruleType,
  newButtonLabel,
  refreshKey,
  description,
  buildConfig,
  formContent,
}: RuleTabProps) {
  const canManage = usePermission('admin.page.risk_rules.manage');
  const [items, setItems] = useState<RiskRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const action = Form.useWatch('action', form) as RiskAction | undefined;
  const isDangerous = !!action && DANGEROUS_ACTIONS.has(action);

  const fetch = async () => {
    setLoading(true);
    try {
      const res = await riskRuleApi.listRules({ ruleType });
      setItems(res.items ?? []);
    } catch {
      message.error('加载规则失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruleType, refreshKey]);

  const handleCreate = async () => {
    const v = await form.validateFields();
    const dangerous = DANGEROUS_ACTIONS.has(v.action as RiskAction);
    if (dangerous && !v.confirmDangerousAction) {
      message.error('该动作为危险操作，请勾选下方确认框后再提交');
      return;
    }
    try {
      const config = buildConfig(v);
      await riskRuleApi.createRule({
        ruleType,
        name: v.name,
        action: v.action,
        config,
        isActive: true,
        confirmDangerousAction: dangerous ? true : undefined,
      });
      message.success('已创建');
      setOpen(false);
      form.resetFields();
      fetch();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? '创建失败';
      message.error(msg);
    }
  };

  const handleToggle = async (rule: RiskRule, isActive: boolean) => {
    try {
      await riskRuleApi.updateRule(rule.id, { isActive });
      message.success(isActive ? '已启用' : '已停用');
      fetch();
    } catch {
      message.error('操作失败');
    }
  };

  const handleDelete = async (rule: RiskRule) => {
    try {
      await riskRuleApi.deleteRule(rule.id);
      message.success('已删除');
      fetch();
    } catch {
      message.error('删除失败');
    }
  };

  const columns = [
    {
      title: '规则名',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
    },
    {
      title: '触发条件',
      key: 'desc',
      render: (_: unknown, r: RiskRule) => description(r),
    },
    {
      title: '动作',
      key: 'action',
      width: 110,
      render: (_: unknown, r: RiskRule) => (
        <Tag variant="muted">{ACTION_LABEL[r.action]}</Tag>
      ),
    },
    {
      title: '启停',
      key: 'isActive',
      width: 90,
      render: (_: unknown, r: RiskRule) => (
        <Switch
          checked={r.isActive}
          disabled={!canManage}
          onChange={(c) => handleToggle(r, c)}
          size="small"
        />
      ),
    },
    {
      title: '触发计数',
      key: 'triggerCount',
      width: 90,
      render: (_: unknown, r: RiskRule) => r.triggerCount,
    },
    {
      title: '最近触发',
      key: 'lastTriggeredAt',
      width: 140,
      render: (_: unknown, r: RiskRule) =>
        r.lastTriggeredAt ? (
          dayjs(r.lastTriggeredAt).fromNow()
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        ),
    },
    {
      title: '操作',
      key: 'op',
      width: 90,
      align: 'right' as const,
      render: (_: unknown, r: RiskRule) => (
        <Popconfirm
          title="确认删除该规则？"
          onConfirm={() => handleDelete(r)}
        >
          <Button size="small" type="link" danger disabled={!canManage}>
            删除
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 12,
          justifyContent: 'flex-end',
        }}
      >
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!canManage}
          onClick={() => setOpen(true)}
        >
          {newButtonLabel}
        </Button>
      </div>

      <DataTable<RiskRule>
        columns={columns}
        dataSource={items}
        rowKey="id"
        loading={loading}
        searchable
        searchPlaceholder="搜索规则 / 模型"
        pagination={false}
        scroll={{ x: 900 }}
      />

      <Modal
        title={newButtonLabel}
        open={open}
        onOk={handleCreate}
        onCancel={() => setOpen(false)}
        destroyOnClose
        okText="创建"
        okButtonProps={{ disabled: !canManage }}
      >
        <Form form={form} layout="vertical" disabled={!canManage}>
          <Form.Item
            name="name"
            label="规则名"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          {formContent()}
          <Form.Item
            name="action"
            label="动作"
            rules={[{ required: true }]}
            initialValue="ALERT"
            tooltip="ALERT 仅创建告警标记，BLOCK/DISABLE_KEY/FREEZE_USER 会立即处置用户"
          >
            <Select options={ACTION_OPTIONS} />
          </Form.Item>
          {isDangerous && (
            <Form.Item
              name="confirmDangerousAction"
              valuePropName="checked"
              rules={[
                {
                  validator: (_, value) =>
                    value
                      ? Promise.resolve()
                      : Promise.reject(new Error('请确认你了解该动作的影响')),
                },
              ]}
            >
              <Checkbox>
                <span style={{ color: 'var(--color-warn, #d48806)' }}>
                  我已了解 {action ? ACTION_LABEL[action] : ''} 会立即处置用户，确认创建该规则
                </span>
              </Checkbox>
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}

function FraudProviderTab({ refreshKey }: { refreshKey: number }) {
  const canManage = usePermission('admin.page.risk_rules.manage');
  const [items, setItems] = useState<RiskRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const fraudAction = Form.useWatch('action', form) as RiskAction | undefined;
  const fraudDangerous = !!fraudAction && DANGEROUS_ACTIONS.has(fraudAction);

  const fetch = async () => {
    setLoading(true);
    try {
      const res = await riskRuleApi.listRules({ ruleType: 'FRAUD_PROVIDER' });
      setItems(res.items ?? []);
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetch();
  }, [refreshKey]);

  const handleCreate = async () => {
    const v = await form.validateFields();
    const action: RiskAction = (v.action ?? 'ALERT') as RiskAction;
    const dangerous = DANGEROUS_ACTIONS.has(action);
    if (dangerous && !v.confirmDangerousAction) {
      message.error('该动作为危险操作，请勾选下方确认框后再提交');
      return;
    }
    try {
      await riskRuleApi.createRule({
        ruleType: 'FRAUD_PROVIDER',
        name: v.name,
        action,
        config: {
          provider: v.provider,
          webhookUrl: v.webhookUrl ?? null,
          apiKey: v.apiKey ?? null,
        },
        isActive: true,
        confirmDangerousAction: dangerous ? true : undefined,
      });
      message.success('已接入');
      setOpen(false);
      form.resetFields();
      fetch();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? '接入失败';
      message.error(msg);
    }
  };

  const columns = [
    {
      title: '提供商',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '类型',
      key: 'provider',
      render: (_: unknown, r: RiskRule) =>
        (r.config as { provider?: string })?.provider ?? '—',
    },
    {
      title: '状态',
      key: 'isActive',
      width: 100,
      render: (_: unknown, r: RiskRule) => (
        <Tag variant={r.isActive ? 'success' : 'muted'}>
          {r.isActive ? '已接入' : '未启用'}
        </Tag>
      ),
    },
    {
      title: '配置',
      key: 'config',
      ellipsis: true,
      render: (_: unknown, r: RiskRule) =>
        Object.keys(r.config ?? {}).length > 0 ? '已配置' : '—',
    },
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 12,
          justifyContent: 'flex-end',
        }}
      >
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!canManage}
          onClick={() => setOpen(true)}
        >
          接入
        </Button>
      </div>

      <DataTable<RiskRule>
        columns={columns}
        dataSource={items}
        rowKey="id"
        loading={loading}
        searchable
        searchPlaceholder="搜索规则 / Provider"
        pagination={false}
        scroll={{ x: 800 }}
      />

      <Modal
        title="接入第三方反欺诈"
        open={open}
        onOk={handleCreate}
        onCancel={() => setOpen(false)}
        destroyOnClose
        okText="接入"
        okButtonProps={{ disabled: !canManage }}
      >
        <Form form={form} layout="vertical" disabled={!canManage}>
          <Form.Item name="name" label="规则名" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="provider"
            label="提供商"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: 'FINGERPRINTJS', label: 'FingerprintJS' },
                { value: 'RECAPTCHA', label: 'reCAPTCHA' },
                { value: 'SIFT', label: 'Sift' },
                { value: 'CUSTOM', label: '自定义 webhook' },
              ]}
            />
          </Form.Item>
          <Form.Item name="webhookUrl" label="Webhook URL">
            <Input placeholder="https://..." />
          </Form.Item>
          <Form.Item name="apiKey" label="API Key">
            <Input.Password />
          </Form.Item>
          <Form.Item
            name="action"
            label="命中动作"
            initialValue="ALERT"
          >
            <Select options={ACTION_OPTIONS} />
          </Form.Item>
          {fraudDangerous && (
            <Form.Item
              name="confirmDangerousAction"
              valuePropName="checked"
              rules={[
                {
                  validator: (_, value) =>
                    value
                      ? Promise.resolve()
                      : Promise.reject(new Error('请确认你了解该动作的影响')),
                },
              ]}
            >
              <Checkbox>
                <span style={{ color: 'var(--color-warn, #d48806)' }}>
                  我已了解 {fraudAction ? ACTION_LABEL[fraudAction] : ''} 会立即处置用户，确认接入该规则
                </span>
              </Checkbox>
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}

export default function RiskRulesPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  const tabs = useMemo(
    () => [
      {
        key: 'blacklist',
        label: '黑名单',
        children: <BlacklistTab refreshKey={refreshKey} />,
      },
      {
        key: 'usage',
        label: '异常用量',
        children: (
          <RuleTab
            ruleType="USAGE_THRESHOLD"
            newButtonLabel="新建用量规则"
            refreshKey={refreshKey}
            description={(r) => {
              const cfg = r.config as {
                metric?: string;
                threshold?: number;
                windowSec?: number;
              };
              const window = cfg.windowSec
                ? `${Math.round(cfg.windowSec / 3600)}h`
                : '—';
              return `${cfg.metric ?? '—'} > ${cfg.threshold ?? '—'} / ${window}`;
            }}
            buildConfig={(v) => ({
              metric: v.metric,
              threshold: v.threshold,
              windowSec: v.windowSec,
            })}
            formContent={() => (
              <>
                <Form.Item
                  name="metric"
                  label="指标"
                  rules={[{ required: true }]}
                  initialValue="DAILY_TOKEN"
                >
                  <Select
                    options={[
                      { value: 'DAILY_TOKEN', label: '总 token' },
                      { value: 'DAILY_COST', label: '消费(分)' },
                      { value: 'MODEL_CALL_COUNT', label: '调用次数' },
                    ]}
                  />
                </Form.Item>
                <Form.Item
                  name="threshold"
                  label="阈值"
                  rules={[{ required: true }]}
                >
                  <StableNumberInput style={{ width: '100%' }} min={1} precision={0} />
                </Form.Item>
                <Form.Item
                  name="windowSec"
                  label="窗口(秒)"
                  rules={[{ required: true }]}
                  initialValue={86400}
                  tooltip="60-604800 秒之间，默认 86400 (一天)"
                >
                  <StableNumberInput
                    style={{ width: '100%' }}
                    min={60}
                    max={604800}
                    precision={0}
                  />
                </Form.Item>
              </>
            )}
          />
        ),
      },
      {
        key: 'ip',
        label: '同 IP 多账号',
        children: (
          <RuleTab
            ruleType="IP_LIMIT"
            newButtonLabel="新建 IP 规则"
            refreshKey={refreshKey}
            description={(r) => {
              const cfg = r.config as {
                maxAccountsPerIp?: number;
                windowDays?: number;
              };
              return `同 IP 注册 > ${cfg.maxAccountsPerIp ?? '—'} 账号 / ${cfg.windowDays ?? 7} 天`;
            }}
            buildConfig={(v) => ({
              windowDays: v.windowDays,
              maxAccountsPerIp: v.maxAccountsPerIp,
            })}
            formContent={() => (
              <>
                <Form.Item
                  name="maxAccountsPerIp"
                  label="阈值(账号数)"
                  rules={[{ required: true }]}
                  initialValue={5}
                >
                  <StableNumberInput style={{ width: '100%' }} min={2} max={1000} precision={0} />
                </Form.Item>
                <Form.Item
                  name="windowDays"
                  label="时间窗口(天)"
                  rules={[{ required: true }]}
                  initialValue={7}
                >
                  <StableNumberInput style={{ width: '100%' }} min={1} max={90} precision={0} />
                </Form.Item>
              </>
            )}
          />
        ),
      },
      {
        key: 'refund',
        label: '退款监控',
        children: (
          <RuleTab
            ruleType="REFUND_RATE"
            newButtonLabel="新建退款规则"
            refreshKey={refreshKey}
            description={(r) => {
              const cfg = r.config as {
                scope?: string;
                thresholdPct?: number;
                windowDays?: number;
              };
              return `${cfg.scope ?? 'GLOBAL'} 退款率 > ${cfg.thresholdPct ?? '—'}% / ${cfg.windowDays ?? '—'} 天`;
            }}
            buildConfig={(v) => ({
              scope: v.scope,
              thresholdPct: v.thresholdPct,
              windowDays: v.windowDays,
            })}
            formContent={() => (
              <>
                <Form.Item
                  name="scope"
                  label="范围"
                  rules={[{ required: true }]}
                  initialValue="GLOBAL"
                  tooltip="PRODUCT 范围尚未实现，已移除选项；如需按产品监控请改用 USER"
                >
                  <Select
                    options={[
                      { value: 'GLOBAL', label: '全局' },
                      { value: 'USER', label: '用户级' },
                    ]}
                  />
                </Form.Item>
                <Form.Item
                  name="thresholdPct"
                  label="退款率阈值(%)"
                  rules={[{ required: true }]}
                  initialValue={10}
                >
                  <StableNumberInput
                    style={{ width: '100%' }}
                    min={0.1}
                    max={100}
                    step={0.1}
                    precision={1}
                  />
                </Form.Item>
                <Form.Item
                  name="windowDays"
                  label="时间窗口(天)"
                  rules={[{ required: true }]}
                  initialValue={30}
                >
                  <StableNumberInput style={{ width: '100%' }} min={1} max={365} precision={0} />
                </Form.Item>
              </>
            )}
          />
        ),
      },
      {
        key: 'fraud',
        label: '第三方反欺诈',
        children: <FraudProviderTab refreshKey={refreshKey} />,
      },
    ],
    [refreshKey],
  );

  return (
    <div>
      <PageHeader
        title="风控规则"
        subtitle="配置黑名单 / 异常用量阈值 / 反欺诈触发动作"
        actions={[
          <Button
            key="refresh"
            onClick={() => setRefreshKey((k) => k + 1)}
          >
            刷新
          </Button>,
        ]}
      />
      <Tabs items={tabs} />
    </div>
  );
}
