export type FinanceReportTab =
  | 'pureGiftAccountChanges'
  | 'pureGiftConsumptionDetails'
  | 'pureGiftConsumptionSummary'
  | 'buyGiftAccountChanges'
  | 'buyGiftAccountSummary'
  | 'buyGiftConsumptionDetails'
  | 'buyGiftConsumptionSummary'
  | 'buyGiftPaymentDetails'
  | 'buyGiftPaymentSummary'
  | 'enterpriseCreditConsumptionDetails'
  | 'enterpriseCreditConsumptionSummary'
  | 'enterpriseCreditSettlement'
  | 'tokenPlanRevenueSummary'
  | 'tokenPlanRevenueDetails'
  | 'tokenPlanRevenueNotes'
  | 'templateNotes'
  | 'summary'
  | 'orders'
  | 'payments'
  | 'balance'
  | 'balanceGrants'
  | 'balanceAllocations'
  | 'credits'
  | 'apiUsage'
  | 'supplier'
  | 'gaps';

export type FinanceReportFilterField =
  | 'user'
  | 'model'
  | 'workspace'
  | 'rechargeBatchNo'
  | 'rechargeOrderNo'
  | 'callTransactionNo'
  | 'channelTradeNo'
  | 'allocationId'
  | 'settlementId'
  | 'repaymentTransactionId'
  | 'orderId'
  | 'merchantOrderNo'
  | 'tradeNo'
  | 'transactionId'
  | 'usageId'
  | 'grantId'
  | 'requestId'
  | 'apiKey'
  | 'product'
  | 'plan';

export interface FinanceReportFilterOption {
  value: FinanceReportFilterField;
  label: string;
  placeholder: string;
}

const option = (
  value: FinanceReportFilterField,
  label: string,
  placeholder = `请输入${label}`,
): FinanceReportFilterOption => ({ value, label, placeholder });

const user = option('user', '用户', '请输入用户 ID、邮箱、手机号或认证企业名称');
const model = option('model', '模型', '请输入完整模型名称');
const workspace = option('workspace', '工作区', '请输入工作区 ID、名称或 slug');
const rechargeBatchNo = option('rechargeBatchNo', '充值批次号', '请输入完整充值批次号');
const rechargeOrderNo = option('rechargeOrderNo', '充值订单号', '请输入完整充值订单号');
const callTransactionNo = option('callTransactionNo', '调用流水号', '请输入完整调用流水号');
const channelTradeNo = option('channelTradeNo', '渠道流水号', '请输入完整渠道流水号');
const allocationId = option('allocationId', '消耗分摊 ID', '请输入完整消耗分摊 ID');
const settlementId = option('settlementId', '结算记录 ID', '请输入完整结算记录 ID');
const repaymentTransactionId = option(
  'repaymentTransactionId',
  '还款流水 ID',
  '请输入完整还款流水 ID',
);
const orderId = option('orderId', '订单号', '请输入完整订单号');
const merchantOrderNo = option('merchantOrderNo', '商户订单号', '请输入完整商户订单号');
const tradeNo = option('tradeNo', '交易号', '请输入完整交易号');
const transactionId = option('transactionId', '流水 ID', '请输入完整流水 ID');
const usageId = option('usageId', '用量 ID', '请输入完整用量 ID');
const grantId = option('grantId', '充值批次 ID', '请输入完整充值批次 ID');
const requestId = option('requestId', '请求 ID', '请输入完整请求 ID');
const apiKey = option('apiKey', 'API Key', '请输入 API Key 前缀');
const product = option('product', '产品', '请输入产品名称');
const plan = option('plan', '套餐', '请输入套餐名称');

export const FINANCE_REPORT_FILTERS_BY_TAB: Readonly<
  Partial<Record<FinanceReportTab, readonly FinanceReportFilterOption[]>>
> = {
  pureGiftAccountChanges: [user, rechargeBatchNo, rechargeOrderNo],
  pureGiftConsumptionDetails: [user, model, callTransactionNo, rechargeBatchNo],
  pureGiftConsumptionSummary: [user, model],
  buyGiftAccountChanges: [user, rechargeBatchNo, rechargeOrderNo],
  buyGiftAccountSummary: [user],
  buyGiftConsumptionDetails: [user, model, callTransactionNo, rechargeBatchNo],
  buyGiftConsumptionSummary: [user, model],
  buyGiftPaymentDetails: [user, rechargeOrderNo, channelTradeNo],
  buyGiftPaymentSummary: [user],
  enterpriseCreditConsumptionDetails: [user, workspace, model, allocationId],
  enterpriseCreditConsumptionSummary: [workspace, product],
  enterpriseCreditSettlement: [
    workspace,
    allocationId,
    settlementId,
    repaymentTransactionId,
  ],
  tokenPlanRevenueSummary: [product, plan],
  tokenPlanRevenueDetails: [user, workspace, orderId, product, plan],
  orders: [user, workspace, orderId, product],
  payments: [user, workspace, merchantOrderNo, tradeNo],
  balance: [user, workspace, transactionId, orderId, usageId],
  balanceGrants: [user, workspace, grantId, rechargeOrderNo, product],
  balanceAllocations: [
    user,
    workspace,
    allocationId,
    usageId,
    grantId,
    rechargeOrderNo,
  ],
  credits: [user, workspace, model, transactionId, requestId],
  apiUsage: [user, workspace, model, usageId, apiKey],
};

export function getFinanceReportFilterOptions(
  tab: FinanceReportTab,
): readonly FinanceReportFilterOption[] {
  return FINANCE_REPORT_FILTERS_BY_TAB[tab] ?? [];
}

export function defaultFinanceReportFilterField(
  tab: FinanceReportTab,
): FinanceReportFilterField | undefined {
  return getFinanceReportFilterOptions(tab)[0]?.value;
}

export function isFinanceReportFilterAllowed(
  tab: FinanceReportTab,
  field: FinanceReportFilterField | undefined,
): boolean {
  if (!field) return false;
  return getFinanceReportFilterOptions(tab).some((item) => item.value === field);
}
