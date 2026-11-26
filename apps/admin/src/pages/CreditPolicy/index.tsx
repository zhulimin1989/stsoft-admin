import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Form,
  Modal,
  Radio,
  Select,
  Space,
  Switch,
  message,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import {
  PageHeader,
  DataTable,
  EmptyPlaceholder,
  StableNumberInput,
} from '../../components/common';
import {
  creditPolicyApi,
  userSegmentApi,
  type CreditPolicyConfig,
  type OverdueUser,
  type UserSegment,
} from '../../api/v2';
import { productApi } from '../../api/admin';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { useCurrentProduct } from '../../hooks/useCurrentProduct';
import { usePermission } from '../../hooks/usePermission';
import { warnNonCritical } from '../../utils/logging';
import { currencyMinorUnitLabel, formatCurrencyCents } from '../../utils/price';

interface ProductRow {
  id: string;
  name: string;
}

interface GlobalFormValues {
  allowOverdraft: boolean;
  defaultCreditLimitCents: number;
  triggerAction: 'SUSPEND' | 'ALERT' | 'EMAIL';
  recoveryCondition: 'ON_RECHARGE' | 'AFTER_DAYS' | 'MANUAL';
  recoveryDays?: number;
}

interface SegmentFormValues {
  segmentId: string;
  defaultCreditLimitCents: number;
}

export default function CreditPolicyPage() {
  const canManage = usePermission('admin.page.credit_policy.manage');
  const navigate = useNavigate();
  const currentProductId = useCurrentProduct();
  const platformCurrency = usePlatformCurrency();
  const minorUnitLabel = currencyMinorUnitLabel(platformCurrency);
  const formatMoney = (value: number) => formatCurrencyCents(value, platformCurrency);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [productId, setProductId] = useState<string | null>(currentProductId);
  const [segments, setSegments] = useState<UserSegment[]>([]);
  const [globalForm] = Form.useForm<GlobalFormValues>();
  const [overrides, setOverrides] = useState<CreditPolicyConfig[]>([]);
  const [overdue, setOverdue] = useState<OverdueUser[]>([]);
  const [loadingGlobal, setLoadingGlobal] = useState(false);
  const [loadingOverdue, setLoadingOverdue] = useState(false);
  const [segmentModalOpen, setSegmentModalOpen] = useState(false);
  const [editingOverride, setEditingOverride] = useState<CreditPolicyConfig | null>(null);
  const [segmentForm] = Form.useForm<SegmentFormValues>();

  // 同步 useCurrentProduct
  useEffect(() => {
    if (currentProductId && currentProductId !== productId) {
      setProductId(currentProductId);
    }
  }, [currentProductId, productId]);

  useEffect(() => {
    productApi
      .list()
      .then((res) => setProducts(Array.isArray(res) ? res : res?.items || []))
      .catch((error: unknown) => {
        warnNonCritical('CreditPolicy product preload', error);
      });
    userSegmentApi
      .list({ pageSize: 100 })
      .then((res) => setSegments(res.items || []))
      .catch((error: unknown) => {
        warnNonCritical('CreditPolicy segment preload', error);
      });
  }, []);

  const loadAll = async (pid: string) => {
    setLoadingGlobal(true);
    setLoadingOverdue(true);
    try {
      const [globalCfg, segs, overdueRes] = await Promise.all([
        creditPolicyApi.getGlobal(pid),
        creditPolicyApi.listSegmentOverrides(pid).catch((error: unknown) => {
          warnNonCritical('CreditPolicy segment override preload', error);
          return { items: [] };
        }),
        creditPolicyApi
          .listOverdueUsers({ productId: pid, pageSize: 50 })
          .catch((error: unknown) => {
            warnNonCritical('CreditPolicy overdue users preload', error);
            return { items: [], total: 0 };
          }),
      ]);
      globalForm.setFieldsValue({
        allowOverdraft: globalCfg.allowOverdraft,
        defaultCreditLimitCents: globalCfg.defaultCreditLimitCents,
        triggerAction: globalCfg.triggerAction,
        recoveryCondition: globalCfg.recoveryCondition,
        recoveryDays: globalCfg.recoveryDays,
      });
      setOverrides(segs.items || []);
      setOverdue(overdueRes.items || []);
    } catch (err: unknown) {
      const code = (err as { response?: { status?: number } })?.response
        ?.status;
      if (code === 404) {
        globalForm.setFieldsValue({
          allowOverdraft: false,
          defaultCreditLimitCents: 0,
          triggerAction: 'SUSPEND',
          recoveryCondition: 'ON_RECHARGE',
          recoveryDays: undefined,
        });
        setOverrides([]);
        setOverdue([]);
      } else {
        message.error('加载信用额度配置失败');
      }
    } finally {
      setLoadingGlobal(false);
      setLoadingOverdue(false);
    }
  };

  useEffect(() => {
    if (productId) {
      loadAll(productId);
    } else {
      setOverrides([]);
      setOverdue([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const handleSaveGlobal = async () => {
    if (!productId) return;
    try {
      const values = await globalForm.validateFields();
      await creditPolicyApi.updateGlobal(productId, values);
      message.success('已保存');
    } catch (err: unknown) {
      if ((err as { errorFields?: unknown })?.errorFields) return;
      message.error('保存失败');
    }
  };

  const openSegmentModal = (override?: CreditPolicyConfig) => {
    segmentForm.resetFields();
    setEditingOverride(override ?? null);
    segmentForm.setFieldsValue({
      segmentId: override?.segmentId,
      defaultCreditLimitCents: override?.defaultCreditLimitCents ?? 0,
    });
    setSegmentModalOpen(true);
  };

  const handleSubmitSegment = async () => {
    if (!productId) return;
    try {
      const values = await segmentForm.validateFields();
      await creditPolicyApi.upsertSegmentOverride(productId, {
        scope: 'SEGMENT',
        segmentId: values.segmentId,
        defaultCreditLimitCents: values.defaultCreditLimitCents,
        // 复用 global 的其他字段
        allowOverdraft: globalForm.getFieldValue('allowOverdraft'),
        triggerAction: globalForm.getFieldValue('triggerAction'),
        recoveryCondition: globalForm.getFieldValue('recoveryCondition'),
        recoveryDays: globalForm.getFieldValue('recoveryDays'),
      });
      message.success(editingOverride ? '分群覆盖已更新' : '已添加分群覆盖');
      setSegmentModalOpen(false);
      setEditingOverride(null);
      loadAll(productId);
    } catch (err: unknown) {
      if ((err as { errorFields?: unknown })?.errorFields) return;
      message.error('保存失败');
    }
  };

  const segmentLabel = (id?: string) =>
    segments.find((s) => s.id === id)?.name ?? id ?? '—';

  const overrideColumns = [
    {
      title: '分群',
      dataIndex: 'segmentId',
      key: 'segmentId',
      render: (id: string) => segmentLabel(id),
    },
    {
      title: '信用额度',
      dataIndex: 'defaultCreditLimitCents',
      key: 'limit',
      render: (v: number) => formatMoney(v),
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      align: 'right' as const,
      render: (_: unknown, row: CreditPolicyConfig) => (
        <Space size={4}>
          <Button type="link" size="small" disabled={!canManage} onClick={() => openSegmentModal(row)}>
            编辑
          </Button>
        </Space>
      ),
    },
  ];

  const overdueColumns = [
    {
      title: '用户',
      key: 'user',
      render: (_: unknown, r: OverdueUser) => (
        <div>
          <div>{r.email}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {r.userId}
          </div>
        </div>
      ),
    },
    {
      title: '当前余额',
      dataIndex: 'balanceCents',
      key: 'balance',
      width: 130,
      render: (v: number) => (
        <span style={{ color: '#dc2626', fontWeight: 500 }}>
          {formatMoney(v)}
        </span>
      ),
    },
    {
      title: '欠费时长',
      dataIndex: 'overdueDays',
      key: 'days',
      width: 100,
      render: (v: number) => `${v} 天`,
    },
    {
      title: '欠费原因',
      dataIndex: 'reason',
      key: 'reason',
    },
    {
      title: '信用额度',
      dataIndex: 'creditLimitCents',
      key: 'creditLimit',
      width: 120,
      render: (v: number) => formatMoney(v),
    },
    {
      title: '操作',
      key: 'actions',
      width: 240,
      align: 'right' as const,
      render: (_: unknown, row: OverdueUser) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => navigate(`/users/${row.userId}`)}>
            查看用户
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="信用额度"
        subtitle="按量产品的先用后付配置 + 欠费用户管理"
      />

      <div style={{ marginBottom: 16 }}>
        <Space>
          <span style={{ color: 'var(--text-muted)' }}>产品：</span>
          <Select
            value={productId ?? undefined}
            onChange={(v) => setProductId(v)}
            placeholder="选择产品"
            style={{ minWidth: 240 }}
            options={products.map((p) => ({ label: p.name, value: p.id }))}
          />
        </Space>
      </div>

      {!productId && (
        <Alert
          type="warning"
          showIcon
          message="请先选择产品"
          description="信用额度配置以产品为维度，请在上方选择一个具体产品。"
        />
      )}

      {productId && (
        <>
          <Card
            title="全局策略"
            style={{ marginBottom: 16 }}
            loading={loadingGlobal}
          >
            <Form
              form={globalForm}
              disabled={!canManage}
              layout="vertical"
              initialValues={{
                allowOverdraft: false,
                defaultCreditLimitCents: 0,
                triggerAction: 'SUSPEND',
                recoveryCondition: 'ON_RECHARGE',
              }}
            >
              <Form.Item
                label="允许透支（先用后付）"
                name="allowOverdraft"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                label={`默认信用额度（${minorUnitLabel}）`}
                name="defaultCreditLimitCents"
                tooltip={`单位是${minorUnitLabel}，${formatCurrencyCents(10000, platformCurrency, { fractionDigits: 0 })} = 10000`}
              >
                <StableNumberInput min={0} precision={0} style={{ width: 240 }} />
              </Form.Item>
              <Form.Item
                label="触发欠费时执行"
                name="triggerAction"
                rules={[{ required: true }]}
              >
                <Radio.Group>
                  <Radio value="SUSPEND">暂停账户</Radio>
                  <Radio value="ALERT">仅告警</Radio>
                  <Radio value="EMAIL">发邮件</Radio>
                </Radio.Group>
              </Form.Item>
              <Form.Item
                label="恢复条件"
                name="recoveryCondition"
                rules={[{ required: true }]}
              >
                <Radio.Group>
                  <Radio value="ON_RECHARGE">充值即恢复</Radio>
                  <Radio value="AFTER_DAYS">X 天后自动</Radio>
                  <Radio value="MANUAL">手动恢复</Radio>
                </Radio.Group>
              </Form.Item>
              <Form.Item
                noStyle
                shouldUpdate={(prev, cur) =>
                  prev.recoveryCondition !== cur.recoveryCondition
                }
              >
                {({ getFieldValue }) =>
                  getFieldValue('recoveryCondition') === 'AFTER_DAYS' ? (
                    <Form.Item label="恢复天数" name="recoveryDays">
                      <StableNumberInput min={1} precision={0} style={{ width: 200 }} />
                    </Form.Item>
                  ) : null
                }
              </Form.Item>
              <Button type="primary" onClick={handleSaveGlobal}>
                保存
              </Button>
            </Form>
          </Card>

          <Card
            title="用户级覆盖"
            style={{ marginBottom: 16 }}
            extra={
              <Button
                type="primary"
                size="small"
                icon={<PlusOutlined />}
                disabled={!canManage}
                onClick={() => openSegmentModal()}
              >
                添加分群覆盖
              </Button>
            }
          >
            <div style={{ marginBottom: 12, color: 'var(--text-muted)' }}>
              为特定分群配置不同信用额度。
            </div>
            {overrides.length === 0 ? (
              <EmptyPlaceholder
                title="暂无分群覆盖"
                description="可针对特定分群覆盖默认信用额度。"
              />
            ) : (
              <DataTable<CreditPolicyConfig>
                columns={overrideColumns}
                dataSource={overrides}
                rowKey="id"
                searchable
                searchPlaceholder="搜索分群 / 产品"
                pagination={false}
              />
            )}
          </Card>

          <Card title="欠费用户" loading={loadingOverdue}>
            {overdue.length === 0 ? (
              <EmptyPlaceholder
                title="暂无欠费用户"
                description="当前无 balance < 0 的用户。"
              />
            ) : (
              <DataTable<OverdueUser>
                columns={overdueColumns}
                dataSource={overdue}
                rowKey="userId"
                searchable
                searchPlaceholder="搜索用户 / 邮箱"
                pagination={false}
                scroll={{ x: 900 }}
              />
            )}
          </Card>
        </>
      )}

      <Modal
        open={segmentModalOpen}
        title={editingOverride ? '编辑分群覆盖' : '添加分群覆盖'}
        onCancel={() => {
          setSegmentModalOpen(false);
          setEditingOverride(null);
        }}
        onOk={handleSubmitSegment}
        okButtonProps={{ disabled: !canManage }}
        destroyOnClose
      >
        <Form form={segmentForm} layout="vertical" disabled={!canManage}>
          <Form.Item
            label="分群"
            name="segmentId"
            rules={[{ required: true, message: '必选' }]}
          >
            <Select
              placeholder="选择分群"
              disabled={!!editingOverride}
              options={segments.map((s) => ({
                label: s.name,
                value: s.id,
              }))}
            />
          </Form.Item>
          <Form.Item
            label={`信用额度（${minorUnitLabel}）`}
            name="defaultCreditLimitCents"
            rules={[{ required: true, type: 'number', min: 0 }]}
          >
            <StableNumberInput min={0} precision={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
