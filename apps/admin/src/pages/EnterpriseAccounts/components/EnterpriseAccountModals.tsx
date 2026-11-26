import {
  Button,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Typography,
  theme,
  type FormInstance,
} from 'antd';
import {
  ModelTierPrices,
  buildDisplayPriceTiers,
  formatPriceTierRange,
} from '../../../components/ModelTierPrices';
import { DataTable, StableNumberInput } from '../../../components/common';
import type {
  EnterpriseAccount,
  EnterpriseAccountCreditEvent,
  EnterpriseModelDiscountRow,
} from '../../../api/v2/enterpriseAccounts';
import {
  accountStatusTag,
  fmtDateTime,
  formatEnterpriseModelPrice,
  formatMoneyAmount,
  formatMoneyCents,
  formatUsageMultiplier,
  positiveYuanAmountRule,
  toFiniteNumber,
  REJECT_CATEGORY_OPTIONS,
} from '../formatters';
import type {
  AttachTenantFormValues,
  CreateEnterpriseAccountFormValues,
  CreditConfigFormValues,
  ProductOption,
  RechargeEnterpriseAccountFormValues,
  RejectReviewFormValues,
} from '../types';
import { EnterpriseCreditPolicyBoundary } from './EnterpriseCreditPolicyBoundary';

interface RejectReviewModalProps {
  open: boolean;
  form: FormInstance<RejectReviewFormValues>;
  acting: boolean;
  onOk: () => void;
  onCancel: () => void;
}

export function RejectReviewModal({
  open,
  form,
  acting,
  onOk,
  onCancel,
}: RejectReviewModalProps) {
  return (
    <Modal
      title="驳回企业认证"
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      confirmLoading={acting}
      okText="确认驳回"
      okButtonProps={{ danger: true }}
      cancelText="取消"
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="rejectCategory"
          label="驳回分类"
          rules={[{ required: true, message: '请选择驳回分类' }]}
          tooltip="打款信息问题 → 用户重新填写金额；企业信息问题 → 用户需重走企业认证"
        >
          <Select options={REJECT_CATEGORY_OPTIONS} placeholder="选择驳回分类" />
        </Form.Item>
        <Form.Item
          name="rejectReason"
          label="驳回原因"
          rules={[{ required: true, message: '请填写驳回原因' }]}
        >
          <Input.TextArea rows={3} placeholder="向用户说明驳回原因（用户可见）" />
        </Form.Item>
        {/* 业务方要求：驳回弹窗不展示「运营备注（可选）」。字段保留在表单内（可重置/回填），仅视觉隐藏。 */}
        <Form.Item name="note" label="运营备注（可选）" style={{ display: 'none' }}>
          <Input.TextArea rows={2} placeholder="内部备注" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

interface CreateEnterpriseAccountModalProps {
  open: boolean;
  form: FormInstance<CreateEnterpriseAccountFormValues>;
  acting: boolean;
  onOk: () => void;
  onCancel: () => void;
}

export function CreateEnterpriseAccountModal({
  open,
  form,
  acting,
  onOk,
  onCancel,
}: CreateEnterpriseAccountModalProps) {
  return (
    <Modal
      title="创建 / 补救企业账户"
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      confirmLoading={acting}
      okText="提交"
      cancelText="取消"
    >
      <p style={{ color: '#888', marginBottom: 12 }}>
        后端会先查询该用户的企业实名记录：非企业实名或实名未通过将被拒绝；企业名称 / 统一社会信用代码 /
        认证时间以 user 侧实名快照为准，不从前端拼装。
      </p>
      <Form form={form} layout="vertical">
        <Form.Item
          name="userId"
          label="用户 ID"
          rules={[{ required: true, message: '请输入用户 ID' }]}
        >
          <Input placeholder="要开通企业账户的用户 ID" />
        </Form.Item>
        <Form.Item
          name="verificationId"
          label="企业实名 ID（可选）"
          tooltip="不填时后端取该用户已通过的企业实名记录"
        >
          <Input placeholder="指定企业实名记录 id（可选）" />
        </Form.Item>
        <Form.Item name="tenantId" label="Tenant ID（可选）">
          <Input placeholder="不填时以实名快照关联的 tenant 为准" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

interface AttachTenantModalProps {
  open: boolean;
  form: FormInstance<AttachTenantFormValues>;
  acting: boolean;
  onOk: () => void;
  onCancel: () => void;
}

export function AttachTenantModal({
  open,
  form,
  acting,
  onOk,
  onCancel,
}: AttachTenantModalProps) {
  return (
    <Modal
      title="挂载 tenant"
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      confirmLoading={acting}
      okText="挂载"
      cancelText="取消"
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="tenantId"
          label="Tenant ID"
          rules={[{ required: true, message: '请输入 tenant ID' }]}
        >
          <Input placeholder="要挂载到该企业账户的 tenant ID" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

interface RechargeEnterpriseAccountModalProps {
  open: boolean;
  account: EnterpriseAccount | null;
  form: FormInstance<RechargeEnterpriseAccountFormValues>;
  acting: boolean;
  productLoading: boolean;
  products: ProductOption[];
  currencyCode: string;
  onOk: () => void;
  onCancel: () => void;
}

export function RechargeEnterpriseAccountModal({
  open,
  account,
  form,
  acting,
  productLoading,
  products,
  currencyCode,
  onOk,
  onCancel,
}: RechargeEnterpriseAccountModalProps) {
  const { token } = theme.useToken();
  const balance = account?.credit
    ? formatMoneyCents(account.credit.accountBalanceCents, currencyCode)
    : formatMoneyAmount(account?.balanceUsd, currencyCode);

  return (
    <Modal
      title="企业账户充值"
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      confirmLoading={acting}
      maskClosable={!acting}
      closable={!acting}
      okButtonProps={{ disabled: acting }}
      cancelButtonProps={{ disabled: acting }}
      okText="确认充值"
      cancelText="取消"
    >
      <div
        style={{
          marginBottom: 20,
          padding: 16,
          background: token.colorFillAlter,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: token.borderRadiusLG,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <Typography.Text strong style={{ fontSize: 16 }}>
            {account?.enterpriseName || account?.name || '—'}
          </Typography.Text>
          {accountStatusTag(account?.status)}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minWidth: 0,
            marginTop: 12,
          }}
        >
          <Typography.Text type="secondary" style={{ flexShrink: 0, fontSize: 12 }}>
            账户 ID
          </Typography.Text>
          <Typography.Text
            type="secondary"
            copyable={account?.id ? { text: account.id, tooltips: ['复制账户 ID', '已复制'] } : undefined}
            ellipsis={account?.id ? { tooltip: account.id } : undefined}
            style={{ minWidth: 0, fontFamily: 'monospace' }}
          >
            {account?.id || '—'}
          </Typography.Text>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 16,
            marginTop: 16,
            paddingTop: 12,
            borderTop: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Typography.Text type="secondary">当前余额（{currencyCode}）</Typography.Text>
          <Typography.Text strong style={{ fontSize: 22, lineHeight: 1.2 }}>
            {balance}
          </Typography.Text>
        </div>
      </div>
      <Form form={form} layout="vertical">
        <Form.Item
          name="productId"
          label="关联产品"
          rules={[{ required: true, message: '请选择关联产品' }]}
          tooltip="充值流水会按该产品进入财务对账和按量口径。"
        >
          <Select
            showSearch
            optionFilterProp="label"
            loading={productLoading}
            placeholder="选择按量产品"
            options={products.map((product) => ({
              value: product.id,
              label: `${product.name}${product.billingMode ? ` (${product.billingMode})` : ''}`,
            }))}
          />
        </Form.Item>
        <Form.Item
          name="amount"
          label={`充值金额（${currencyCode}）`}
          rules={[
            { required: true, message: '请输入充值金额' },
            positiveYuanAmountRule('请输入大于 0 的充值金额'),
          ]}
        >
          <StableNumberInput min={0} precision={2} style={{ width: '100%' }} placeholder="0.00" />
        </Form.Item>
        <Form.Item
          name="description"
          label="备注"
          rules={[{ required: true, message: '请填写充值备注' }]}
        >
          <Input.TextArea rows={2} placeholder="例如 线下转账入账 / 合同预充值" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

interface EnterpriseModelDiscountModalProps {
  open: boolean;
  acting: boolean;
  loading: boolean;
  products: ProductOption[];
  productId?: string;
  rows: EnterpriseModelDiscountRow[];
  drafts: Record<string, number>;
  batchValue: number | null;
  currency: string;
  onOk: () => void;
  onCancel: () => void;
  onProductChange: (productId: string) => void;
  onBatchValueChange: (value: number | null) => void;
  onApplyBatch: () => void;
  onDraftChange: (modelName: string, value: number) => void;
}

/**
 * 档位解析与渲染已抽到 `components/ModelTierPrices`，与「按量定价」页共用同一实现
 * —— 两个页面渲染的是同一份后端契约（tiers[] + fallbackPricing），各写一套会导致
 * 同一批价格在两页显示不一致。
 * 本文件只保留企业侧的列头文案（「企业价」）与 aria/testid 命名。
 */
// 对外导出保持不变：既有引用与测试按此名字使用。
export const formatEnterprisePriceTierRange = formatPriceTierRange;

export function EnterpriseModelTierPrices({
  row,
  multiplier,
  currency,
}: {
  row: EnterpriseModelDiscountRow;
  multiplier: number;
  currency: string;
}) {
  const persistedMultiplier = toFiniteNumber(row.priceMultiplier, 1);
  return (
    <ModelTierPrices
      tiers={buildDisplayPriceTiers(row)}
      persistedMultiplier={persistedMultiplier}
      draftMultiplier={multiplier}
      currency={currency}
      formatPrice={formatEnterpriseModelPrice}
      ariaLabel={`${row.modelName} 标准价格档`}
      testIdPrefix={`enterprise-price-tier-${row.modelName}`}
      effectiveHeader="企业价"
    />
  );
}

export function EnterpriseModelDiscountModal({
  open,
  acting,
  loading,
  products,
  productId,
  rows,
  drafts,
  batchValue,
  currency,
  onOk,
  onCancel,
  onProductChange,
  onBatchValueChange,
  onApplyBatch,
  onDraftChange,
}: EnterpriseModelDiscountModalProps) {
  return (
    <Modal
      title="配置企业模型专属折扣"
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      confirmLoading={acting}
      okText="保存"
      cancelText="取消"
      width={1100}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div style={{ color: '#667085', fontSize: 13 }}>
          企业价按请求命中的标准价格档 × 企业折扣倍率计算，不叠加 PAYG 产品倍率。
        </div>
        <Space wrap>
          <Select
            style={{ minWidth: 260 }}
            value={productId}
            loading={loading}
            placeholder="选择 PAYG 产品"
            options={products.map((product) => ({
              value: product.id,
              label: `${product.name}${product.billingMode ? ` (${product.billingMode})` : ''}`,
            }))}
            onChange={onProductChange}
          />
          <StableNumberInput
            min={0.0001}
            max={1}
            precision={4}
            step={0.05}
            value={batchValue}
            placeholder="批量倍率"
            onChange={(value) => onBatchValueChange(value == null ? null : Number(value))}
          />
          <Button disabled={batchValue == null} onClick={onApplyBatch}>
            应用到全部模型
          </Button>
        </Space>
        <DataTable<EnterpriseModelDiscountRow>
          rowKey="modelName"
          size="small"
          loading={loading}
          pagination={false}
          dataSource={rows}
          columns={[
            {
              title: '模型',
              dataIndex: 'modelName',
              render: (value: string, row) => (
                <Space direction="vertical" size={0}>
                  <span>{value}</span>
                  <span style={{ color: '#8c98a8', fontSize: 12 }}>
                    {row.provider || 'unknown'} · {row.availability?.active ? '可用' : '未启用'}
                  </span>
                </Space>
              ),
            },
            {
              title: '标准价格档 → 企业价 / 1M',
              width: 430,
              render: (_, row) => {
                const multiplier = drafts[row.modelName]
                  ?? toFiniteNumber(row.priceMultiplier, 1);
                return (
                  <EnterpriseModelTierPrices
                    row={row}
                    multiplier={multiplier}
                    currency={currency}
                  />
                );
              },
            },
            {
              title: '折扣倍率',
              width: 150,
              render: (_, row) => (
                <StableNumberInput
                  min={0.0001}
                  max={1}
                  precision={4}
                  step={0.05}
                  value={drafts[row.modelName] ?? toFiniteNumber(row.priceMultiplier, 1)}
                  onChange={(value) => {
                    const nextValue = value == null ? 1 : Number(value);
                    onDraftChange(row.modelName, nextValue);
                  }}
                />
              ),
            },
            {
              title: '状态',
              width: 120,
              render: (_, row) => (
                <Space direction="vertical" size={0}>
                  <span>{row.configured ? '已配置' : '默认'}</span>
                  <span style={{ color: '#8c98a8', fontSize: 12 }}>
                    {formatUsageMultiplier(drafts[row.modelName] ?? row.priceMultiplier)}
                  </span>
                </Space>
              ),
            },
          ]}
        />
      </Space>
    </Modal>
  );
}

interface CreditConfigModalProps {
  open: boolean;
  form: FormInstance<CreditConfigFormValues>;
  acting: boolean;
  currency: string;
  currencyCode: string;
  creditEvents: EnterpriseAccountCreditEvent[];
  onOk: () => void;
  onCancel: () => void;
}

interface CreditEventAuditTrailProps {
  creditEvents: EnterpriseAccountCreditEvent[];
  currency: string;
}

export function CreditEventAuditTrail({
  creditEvents,
  currency,
}: CreditEventAuditTrailProps) {
  if (creditEvents.length === 0) return null;
  return (
    <>
      <h4 style={{ margin: '16px 0 8px' }}>信用策略时间边界审计（最近 5 条）</h4>
      <Descriptions column={1} size="small" bordered>
        {creditEvents.slice(0, 5).map((event) => (
          <Descriptions.Item key={event.id} label={fmtDateTime(event.createdAt)}>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <span>
                {event.oldStatus || '—'} / {formatMoneyCents(event.oldLimitCents, currency)}
                {' → '}
                {event.newStatus} / {formatMoneyCents(event.newLimitCents, currency)}
                {event.reason ? ` · ${event.reason}` : ''}
              </span>
              <EnterpriseCreditPolicyBoundary
                snapshot={event}
                showDecisionTimeline
                showFanout
              />
            </Space>
          </Descriptions.Item>
        ))}
      </Descriptions>
    </>
  );
}

export function CreditConfigModal({
  open,
  form,
  acting,
  currency,
  currencyCode,
  creditEvents,
  onOk,
  onCancel,
}: CreditConfigModalProps) {
  return (
    <Modal
      title="配置企业信用额度"
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      confirmLoading={acting}
      okText="保存"
      cancelText="取消"
    >
      <Form form={form} layout="vertical" initialValues={{ status: 'DISABLED', limitAmount: 0 }}>
        <Form.Item
          name="limitAmount"
          label={`信用额度（${currencyCode}）`}
          rules={[{ required: true, message: '请输入信用额度' }]}
        >
          <StableNumberInput min={0} precision={2} style={{ width: '100%' }} placeholder="0.00" />
        </Form.Item>
        <Form.Item name="status" label="状态" rules={[{ required: true, message: '请选择状态' }]}>
          <Select
            options={[
              { label: '启用', value: 'ACTIVE' },
              { label: '停用', value: 'DISABLED' },
              { label: '暂停', value: 'SUSPENDED' },
            ]}
          />
        </Form.Item>
        {/*
          账期天数只在「启用 + 正额度」时是必填,其余情形可留空 —— 这与后端
          enterprise-account.service.ts 的守卫逐条对应:
            nextStatus === ACTIVE && nextLimitUsd > 0 && (termsDays 为空或 <= 0)
              -> BadRequestException('启用正信用额度时 termsDays 必须为正整数')
          此前这里固定标为「可选」,于是「额度 5 + 启用 + 账期留空」在页面上看不出问题,
          提交后只得到一个没有正文的 400(2026-09-03 上海 UAT 实际发生)。
          用 dependencies 让 label 与校验随 status/limitAmount 实时变化,
          把这条后端契约在提交前就呈现出来。
        */}
        <Form.Item noStyle dependencies={['status', 'limitAmount']}>
          {({ getFieldValue }) => {
            const required = getFieldValue('status') === 'ACTIVE'
              && Number(getFieldValue('limitAmount') ?? 0) > 0;
            return (
              <Form.Item
                name="termsDays"
                label={required ? '账期天数' : '账期天数（可选）'}
                rules={required
                  ? [{
                    required: true,
                    // 后端要求正整数:0 与负数同样会被拒,所以不能只校验「非空」。
                    validator: (_rule, value) => (
                      typeof value === 'number' && Number.isInteger(value) && value > 0
                        ? Promise.resolve()
                        : Promise.reject(new Error('启用正信用额度时必须填写账期天数（正整数）'))
                    ),
                  }]
                  : []}
                extra={required ? '启用状态下额度大于 0 时必填' : undefined}
              >
                <StableNumberInput min={0} precision={0} style={{ width: '100%' }} placeholder="例如 30" />
              </Form.Item>
            );
          }}
        </Form.Item>
        <Form.Item name="expiresAt" label="到期日期（可选）">
          <Input placeholder="YYYY-MM-DD" />
        </Form.Item>
        <Form.Item
          name="reason"
          label="变更原因"
          rules={[{ required: true, message: '请填写变更原因' }]}
        >
          <Input.TextArea rows={2} placeholder="例如 合同授信 / 临时调整 / 风控暂停" />
        </Form.Item>
        <Form.Item name="note" label="备注（可选）">
          <Input.TextArea rows={2} placeholder="内部备注" />
        </Form.Item>
      </Form>
      <CreditEventAuditTrail creditEvents={creditEvents} currency={currency} />
    </Modal>
  );
}
