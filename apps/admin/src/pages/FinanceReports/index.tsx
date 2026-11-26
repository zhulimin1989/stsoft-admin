import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Button, Segmented, Select, Space, Tabs, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CloudDownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { financeReportsApi } from '../../api/admin';
import { DataTable, PageHeader, StatCard, StatCardGroup } from '../../components/common';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { usePermission } from '../../hooks/usePermission';
import { currencySymbol, formatCurrencyCents } from '../../utils/price';
import { FinanceReportQueryBar } from './FinanceReportQueryBar';
import {
  defaultFinanceReportFilterField,
  getFinanceReportFilterOptions,
  isFinanceReportFilterAllowed,
  type FinanceReportFilterField,
  type FinanceReportTab,
} from './financeReportFilters';
import { formatExactDecimal, formatExactRatioPercent, formatFinanceTableMoney } from './formatters';
import './FinanceReports.css';

type ReportMode = 'pureGift' | 'buyGift' | 'enterpriseCredit' | 'subscription' | 'tokenPlan' | 'audit';
type FinancePageVariant = 'reports' | 'reconciliation';
type BillingModeFilter = 'ALL' | 'SUBSCRIPTION' | 'PAY_AS_YOU_GO' | 'CODING_PLAN';

type ReportTab = FinanceReportTab;

const summaryTabs = new Set<ReportTab>([
  'pureGiftConsumptionSummary',
  'buyGiftAccountSummary',
  'buyGiftConsumptionSummary',
  'buyGiftPaymentSummary',
  'enterpriseCreditConsumptionSummary',
  'tokenPlanRevenueSummary',
  'summary',
]);

interface FinanceReportData {
  period: FinanceReportPeriod;
  metrics: {
    orderCount: number;
    refundedOrderCount: number;
    tokenUsageCount: number;
    orderRevenueCents: number;
    rechargeCents: number;
    balanceConsumeCents: number;
    refundCents: number;
    apiChargeCents: number;
    tokenPlanRecognizedRevenueCents?: number;
    tokenPlanClosingDeferredCents?: number;
    totalTokens: number;
  };
  monthlySummary: Record<string, unknown>[];
  orderReports?: Record<string, unknown>[];
  paymentReconciliation?: Record<string, unknown>[];
  balanceTransactions?: Record<string, unknown>[];
  balanceGrants?: Record<string, unknown>[];
  balanceConsumptionAllocations?: Record<string, unknown>[];
  creditTransactions?: Record<string, unknown>[];
  apiUsage?: Record<string, unknown>[];
  tokenPlanRevenueRecognition?: {
    summary: Record<string, unknown>[];
    details: Record<string, unknown>[];
    notes: Record<string, unknown>[];
  };
  financeTemplates?: {
    pureGift: {
      accountChangeDetails: Record<string, unknown>[];
      consumptionDetails: Record<string, unknown>[];
      consumptionSummary: Record<string, unknown>[];
    };
    buyGift: {
      accountChangeDetails: Record<string, unknown>[];
      accountChangeSummary: Record<string, unknown>[];
      consumptionDetails: Record<string, unknown>[];
      consumptionSummary: Record<string, unknown>[];
      paymentDetails: Record<string, unknown>[];
      paymentSummary: Record<string, unknown>[];
    };
    notes: Record<string, unknown>[];
  };
  supplierCosts: {
    rows: Record<string, unknown>[];
    status: string;
    requiredFields: string[];
  };
  fieldGaps: Record<string, unknown>[];
  detailCounts?: Partial<Record<ReportTab, number | null>>;
  rowLimits: { maxRowsPerDetail: number | null; note: string };
}

interface FinanceReportDetailData {
  period: FinanceReportPeriod;
  tab: ReportTab;
  rows: Record<string, unknown>[];
  pagination: {
    mode: 'cursor' | 'static';
    pageSize: number;
    hasMore: boolean;
    nextCursor: string | null;
    rowsReturned: number;
  };
}

interface FinanceExportJob {
  filename: string;
}

interface FinanceReportPeriod {
  month: string;
  startDate: string;
  endDate: string;
  asOf?: string;
  cutoffExclusive?: string;
  timezone?: string;
}

export function formatFinanceReportAsOf(period?: FinanceReportPeriod | null): string | null {
  if (!period?.asOf || !period.timezone) return null;
  const asOf = new Date(period.asOf);
  if (Number.isNaN(asOf.getTime())) return null;

  try {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: period.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(asOf);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value;
    const [year, month, day, hour, minute, second] = [
      value('year'),
      value('month'),
      value('day'),
      value('hour'),
      value('minute'),
      value('second'),
    ];
    if (!year || !month || !day || !hour || !minute || !second) return null;
    return `当前明细页数据截至 ${year}-${month}-${day} ${hour}:${minute}:${second}（${period.timezone}）`;
  } catch {
    return null;
  }
}

const moneyKeys = new Set([
  'openingBalanceCents',
  'rechargeCents',
  'balanceConsumeCents',
  'refundCents',
  'adjustCents',
  'closingBalanceCents',
  'orderRevenueCents',
  'supplierCostCents',
  'paymentFeeCents',
  'grossProfitCents',
  'invoiceableCents',
  'invoicedCents',
  'originalAmountCents',
  'discountAmountCents',
  'amountCents',
  'refundAmountCents',
  'paidAmountCents',
  'channelFeeCents',
  'settlementNetCents',
  'diffCents',
  'balanceAfterCents',
  'userChargeCents',
  'supplierCostCents',
  'consumedCents',
  'recognizedRevenueCents',
  'bonusConsumedCents',
  'grantPaidCents',
  'grantBonusCents',
  'grantTotalCents',
  'grantRemainingCents',
  'paidCents',
  'bonusCents',
  'grantedCents',
  'remainingCents',
  'orderAmountCents',
  'newDeferredCents',
  'serviceRecognizedRevenueCents',
  'refundAppliedToDeferredCents',
  'refundRevenueReversalCents',
  'recognizedRevenueCents',
  'closingDeferredCents',
  'recognizedToDateCents',
  'deferredVarianceCents',
  'giftRechargeAmountCents',
  'availableAmountCents',
  'openingAvailableBalanceCents',
  'periodRechargeAmountCents',
  'periodConsumeAmountCents',
  'periodExpireWriteOffAmountCents',
  'periodOtherChangeAmountCents',
  'closingAvailableBalanceCents',
  'cumulativeConsumeOrExpireAmountCents',
  'paidRechargeAmountCents',
  'bonusRechargeAmountCents',
  'refundWriteOffPaidCents',
  'refundWriteOffBonusCents',
  'periodRefundWriteOffAmountCents',
  'openingAvailableBalancePaidCents',
  'periodRechargePaidCents',
  'periodRefundWriteOffPaidCents',
  'periodConsumePaidCents',
  'periodExpireWriteOffPaidCents',
  'periodOtherChangePaidCents',
  'closingAvailableBalancePaidCents',
  'cumulativeConsumeOrExpirePaidCents',
  'consumeAmountCents',
  'consumeAmountPaidCents',
  'settledCents',
  'outstandingCents',
  'estimatedSupplierChargeCents',
  'actualSupplierChargeCents',
  'periodCollectionAmountCents',
  'accumulatedCollectionAmountCents',
  'receivableAmountCents',
  'periodRefundPaymentAmountCents',
  'accumulatedRefundPaymentAmountCents',
  'periodInvoiceAmountCents',
  'accumulatedInvoiceAmountCents',
  'stripeAmountCents',
]);

const dateKeys = new Set([
  'createdAt',
  'paidAt',
  'completedAt',
  'refundedAt',
  'validFrom',
  'expiresAt',
  'grantExpiresAt',
  'channelSettlementDate',
  'bankReceivedDate',
  'stripeCreatedAt',
  'rechargeCompletedAt',
  'otherChangeAt',
  'refundCompletedAt',
  'callTime',
  'settlementCreatedAt',
  'settledAt',
  'serviceStartAt',
  'serviceEndAt',
]);

const unitPriceKeys = new Set([
  'unitPriceUsdPerM',
  'inputUnitPrice',
  'cacheReadUnitPrice',
  'cacheWriteUnitPrice',
  'outputUnitPrice',
  'supplierUnitPriceUsdPerM',
]);

const majorCurrencyKeys = new Set([
  'userChargeUsd',
  'paymentDeductionUsd',
  'voucherDeductionUsd',
  'creditDeductionUsd',
  'debtDeductionUsd',
  'consumeAmountUsd',
  'consumeAmountPaidUsd',
  'actualSupplierChargeUsd',
  'estimatedSupplierChargeUsd',
]);

const ratioKeys = new Set([
  'discountRate',
  'rechargeDiscountRate',
  'userDiscount',
  'supplierDiscount',
]);

const billingModeLabels: Record<string, string> = {
  SUBSCRIPTION: '订阅',
  PAY_AS_YOU_GO: '按量',
  CODING_PLAN: 'CodingPlan',
  MIXED: '混合',
};

function formatMoney(value: unknown, currency: string): string {
  if (value === null || value === undefined || value === '') return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return formatCurrencyCents(num, currency);
}

function formatMajorMoney(value: unknown, currency: string): string {
  if (value === null || value === undefined || value === '') return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${currencySymbol(currency)}${formatExactDecimal(value)}`;
}

function formatUnitPrice(value: unknown, currency: string): string {
  const rendered = formatMajorMoney(value, currency);
  return rendered === '—' ? rendered : `${rendered}/1M`;
}

function formatNumber(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return num.toLocaleString('zh-CN');
}

export function formatCustomerMultiplier(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num.toFixed(2) : '—';
}

function formatDate(value: unknown): string {
  if (!value) return '—';
  const parsed = dayjs(String(value));
  return parsed.isValid() ? parsed.format('YYYY-MM-DD HH:mm:ss') : String(value);
}

function renderValue(
  key: string,
  value: unknown,
  currency: string,
  tab?: ReportTab,
  row?: Record<string, unknown>,
) {
  if (moneyKeys.has(key)) {
    const num = Number(value ?? 0);
    const cls = num < 0 ? 'finance-report-money-negative' : num > 0 ? 'finance-report-money-positive' : '';
    const rawAmounts = row?.rawMajorUnitAmounts;
    const rawMajorUnit = rawAmounts && typeof rawAmounts === 'object' && !Array.isArray(rawAmounts)
      ? (rawAmounts as Record<string, unknown>)[key]
      : undefined;
    const rendered = formatFinanceTableMoney(value, currency, {
      summary: !tab || summaryTabs.has(tab),
      rawMajorUnit,
    });
    return <span className={cls}>{rendered}</span>;
  }
  if (unitPriceKeys.has(key)) return formatUnitPrice(value, currency);
  if (key === 'customerMultiplier') {
    const rendered = formatCustomerMultiplier(value);
    return rendered === '—' ? <span className="finance-report-muted">—</span> : rendered;
  }
  if (majorCurrencyKeys.has(key)) {
    const num = Number(value ?? 0);
    const cls = num < 0 ? 'finance-report-money-negative' : num > 0 ? 'finance-report-money-positive' : '';
    return <span className={cls}>{formatMajorMoney(value, currency)}</span>;
  }
  if (ratioKeys.has(key)) {
    if (value === null || value === undefined || value === '') return <span className="finance-report-muted">—</span>;
    const num = Number(value);
    if (!Number.isFinite(num)) return <span className="finance-report-muted">—</span>;
    return tab && !summaryTabs.has(tab)
      ? formatExactRatioPercent(value)
      : `${(num * 100).toFixed(4)}%`;
  }
  if (key === 'tokenType') {
    const text = String(value ?? '');
    const color = text === 'cache read'
      ? 'green'
      : text === 'cache write'
        ? 'gold'
        : text === 'output'
          ? 'blue'
          : 'default';
    return <Tag color={color}>{text || '—'}</Tag>;
  }
  if (key === 'billingMode') {
    const text = String(value ?? '');
    return text ? <Tag>{billingModeLabels[text] ?? text}</Tag> : <span className="finance-report-muted">—</span>;
  }
  if (dateKeys.has(key)) return formatDate(value);
  if (value === null || value === undefined || value === '') return <span className="finance-report-muted">—</span>;
  if (key === 'tokenTypeBreakdown') {
    const parts = String(value).split(' / ').filter(Boolean);
    if (parts.length === 0 || parts[0] === '—') return <span className="finance-report-muted">—</span>;
    return (
      <Space size={[4, 4]} wrap>
        {parts.map((part) => {
          const color = part.startsWith('缓存读取')
            ? 'green'
            : part.startsWith('缓存写入')
              ? 'gold'
              : part.startsWith('输出')
                ? 'blue'
                : 'default';
          return <Tag key={part} color={color}>{part}</Tag>;
        })}
      </Space>
    );
  }
  if (typeof value === 'number') return formatNumber(value);
  return String(value);
}

function makeColumns(
  keys: Array<{ key: string; title: string; width?: number }>,
  currency: string,
  tab: ReportTab,
): ColumnsType<Record<string, unknown>> {
  return keys.map((item) => ({
    title: item.title,
    dataIndex: item.key,
    key: item.key,
    width: item.width ?? 140,
    render: (value: unknown, row: Record<string, unknown>) => renderValue(item.key, value, currency, tab, row),
  }));
}

const pureGiftAccountChangeKeys = [
  { key: 'rechargeBatchNo', title: '充值批次号', width: 240 },
  { key: 'userLabel', title: '用户' },
  { key: 'currency', title: '币种' },
  { key: 'giftRechargeAmountCents', title: '充值金额-赠送' },
  { key: 'rechargeOrderNo', title: '充值订单号', width: 240 },
  { key: 'rechargeCompletedAt', title: '充值完成时间', width: 180 },
  { key: 'expiresAt', title: '到期时间', width: 180 },
  { key: 'otherChangeAmountCents', title: '其他变动金额' },
  { key: 'otherChangeType', title: '其他变动类型' },
  { key: 'otherChangeAt', title: '其他变动时间', width: 180 },
  { key: 'availableAmountCents', title: '可消耗金额' },
  { key: 'openingAvailableBalanceCents', title: '期初可消耗余额' },
  { key: 'periodRechargeAmountCents', title: '本期充值金额' },
  { key: 'periodConsumeAmountCents', title: '本期消耗金额(负值)' },
  { key: 'periodExpireWriteOffAmountCents', title: '本期到期核销金额(负值)' },
  { key: 'periodOtherChangeAmountCents', title: '本期其他变动金额' },
  { key: 'closingAvailableBalanceCents', title: '期末可消耗余额' },
  { key: 'cumulativeConsumeOrExpireAmountCents', title: '累计消耗或到期核销金额' },
];

const pureGiftConsumptionDetailKeys = [
  { key: 'callTransactionNo', title: '调用流水号', width: 240 },
  { key: 'callTime', title: '调用时间', width: 180 },
  { key: 'userLabel', title: '用户' },
  { key: 'rechargeBatchNo', title: '充值批次号', width: 240 },
  { key: 'model', title: '模型' },
  { key: 'callType', title: '调用类型', width: 240 },
  { key: 'tokenUsage', title: 'Token用量' },
  { key: 'actualSupplierChargeUsd', title: '实际供应商收费' },
  { key: 'supplierUnitPriceUsdPerM', title: '供应商单价' },
  { key: 'supplierDiscount', title: '供应商折扣' },
  { key: 'estimatedSupplierChargeUsd', title: '预计供应商收费' },
];

const pureGiftConsumptionSummaryKeys = [
  { key: 'userLabel', title: '用户' },
  { key: 'userId', title: '用户ID', width: 240 },
  { key: 'model', title: '模型' },
  { key: 'tokenUsage', title: 'Token用量' },
  { key: 'actualSupplierChargeCents', title: '实际供应商收费' },
  { key: 'estimatedSupplierChargeCents', title: '预计供应商收费' },
];

const buyGiftAccountChangeKeys = [
  { key: 'rechargeBatchNo', title: '充值批次号', width: 240 },
  { key: 'userLabel', title: '用户' },
  { key: 'currency', title: '币种' },
  { key: 'paidRechargeAmountCents', title: '充值金额-实收' },
  { key: 'bonusRechargeAmountCents', title: '充值金额-买赠' },
  { key: 'rechargeOrderNo', title: '充值订单号', width: 240 },
  { key: 'rechargeCompletedAt', title: '充值完成时间', width: 180 },
  { key: 'rechargeDiscountRate', title: '充值折扣率' },
  { key: 'refundWriteOffPaidCents', title: '退款核销金额-实收(负值)' },
  { key: 'refundWriteOffBonusCents', title: '退款核销金额-买赠(负值)' },
  { key: 'refundCompletedAt', title: '退款完成时间', width: 180 },
  { key: 'expiresAt', title: '到期时间', width: 180 },
  { key: 'otherChangeAmountCents', title: '其他变动金额' },
  { key: 'otherChangeType', title: '其他变动类型' },
  { key: 'otherChangeAt', title: '其他变动时间', width: 180 },
  { key: 'availableAmountCents', title: '可消耗金额' },
  { key: 'openingAvailableBalanceCents', title: '期初可消耗余额' },
  { key: 'periodRechargeAmountCents', title: '本期充值金额' },
  { key: 'periodRefundWriteOffAmountCents', title: '本期退款核销金额(负值)' },
  { key: 'periodConsumeAmountCents', title: '本期消耗金额(负值)' },
  { key: 'periodExpireWriteOffAmountCents', title: '本期到期核销金额(负值)' },
  { key: 'periodOtherChangeAmountCents', title: '本期其他变动金额' },
  { key: 'closingAvailableBalanceCents', title: '期末可消耗余额' },
  { key: 'cumulativeConsumeOrExpireAmountCents', title: '累计消耗或到期核销金额' },
  { key: 'openingAvailableBalancePaidCents', title: '期初可消耗余额-实收' },
  { key: 'periodRechargePaidCents', title: '本期充值金额-实收' },
  { key: 'periodRefundWriteOffPaidCents', title: '本期退款核销金额-实收(负值)' },
  { key: 'periodConsumePaidCents', title: '本期消耗金额-实收(负值)' },
  { key: 'periodExpireWriteOffPaidCents', title: '本期到期核销金额-实收(负值)' },
  { key: 'periodOtherChangePaidCents', title: '本期其他变动金额-实收' },
  { key: 'closingAvailableBalancePaidCents', title: '期末可消耗余额-实收' },
  { key: 'cumulativeConsumeOrExpirePaidCents', title: '累计消耗或到期核销金额-实收' },
  { key: 'periodCollectionAmountCents', title: '本期收款金额' },
  { key: 'accumulatedCollectionAmountCents', title: '累计收款金额' },
  { key: 'receivableAmountCents', title: '待收金额' },
  { key: 'periodRefundPaymentAmountCents', title: '本期退款支付金额(负值)' },
  { key: 'accumulatedRefundPaymentAmountCents', title: '累计退款支付金额(负值)' },
  { key: 'periodInvoiceAmountCents', title: '本期开票金额' },
  { key: 'accumulatedInvoiceAmountCents', title: '累计开票金额' },
];

const buyGiftAccountSummaryKeys = [
  { key: 'userLabel', title: '用户' },
  { key: 'userId', title: '用户ID', width: 240 },
  { key: 'currency', title: '币种' },
  { key: 'openingAvailableBalanceCents', title: '期初可消耗余额' },
  { key: 'periodRechargeAmountCents', title: '本期充值金额' },
  { key: 'periodRefundWriteOffAmountCents', title: '本期退款核销金额(负值)' },
  { key: 'periodConsumeAmountCents', title: '本期消耗金额(负值)' },
  { key: 'periodExpireWriteOffAmountCents', title: '本期到期核销金额(负值)' },
  { key: 'periodOtherChangeAmountCents', title: '本期其他变动金额' },
  { key: 'closingAvailableBalanceCents', title: '期末可消耗余额' },
  { key: 'cumulativeConsumeOrExpireAmountCents', title: '累计消耗或到期核销金额' },
  { key: 'openingAvailableBalancePaidCents', title: '期初可消耗余额-实收' },
  { key: 'periodRechargePaidCents', title: '本期充值金额-实收' },
  { key: 'periodRefundWriteOffPaidCents', title: '本期退款核销金额-实收(负值)' },
  { key: 'periodConsumePaidCents', title: '本期消耗金额-实收(负值)' },
  { key: 'periodExpireWriteOffPaidCents', title: '本期到期核销金额-实收(负值)' },
  { key: 'periodOtherChangePaidCents', title: '本期其他变动金额-实收' },
  { key: 'closingAvailableBalancePaidCents', title: '期末可消耗余额-实收' },
  { key: 'cumulativeConsumeOrExpirePaidCents', title: '累计消耗或到期核销金额-实收' },
  { key: 'periodCollectionAmountCents', title: '本期收款金额' },
  { key: 'accumulatedCollectionAmountCents', title: '累计收款金额' },
  { key: 'receivableAmountCents', title: '待收金额' },
  { key: 'periodRefundPaymentAmountCents', title: '本期退款支付金额(负值)' },
  { key: 'accumulatedRefundPaymentAmountCents', title: '累计退款支付金额(负值)' },
  { key: 'periodInvoiceAmountCents', title: '本期开票金额' },
  { key: 'accumulatedInvoiceAmountCents', title: '累计开票金额' },
];

const buyGiftConsumptionDetailKeys = [
  { key: 'callTransactionNo', title: '调用流水号', width: 240 },
  { key: 'callTime', title: '调用时间', width: 180 },
  { key: 'userLabel', title: '用户' },
  { key: 'rechargeBatchNo', title: '充值批次号', width: 240 },
  { key: 'model', title: '模型' },
  { key: 'callType', title: '调用类型', width: 240 },
  { key: 'userDiscount', title: '用户折扣' },
  { key: 'unitPriceUsdPerM', title: '单价' },
  { key: 'tokenUsage', title: 'Token用量' },
  { key: 'consumeAmountUsd', title: '消耗金额' },
  { key: 'rechargeDiscountRate', title: '充值折扣率' },
  { key: 'consumeAmountPaidUsd', title: '消耗金额-实收' },
  { key: 'noBalanceConsumptionCallType', title: '无余额消耗的调用类型', width: 200 },
  { key: 'actualSupplierChargeUsd', title: '实际供应商收费' },
  { key: 'supplierUnitPriceUsdPerM', title: '供应商单价' },
  { key: 'supplierDiscount', title: '供应商折扣' },
  { key: 'estimatedSupplierChargeUsd', title: '预计供应商收费' },
];

const buyGiftConsumptionSummaryKeys = [
  { key: 'userLabel', title: '用户' },
  { key: 'userId', title: '用户ID', width: 240 },
  { key: 'model', title: '模型' },
  { key: 'tokenUsage', title: 'Token用量' },
  { key: 'consumeAmountCents', title: '消耗金额' },
  { key: 'consumeAmountPaidCents', title: '消耗金额-实收' },
  { key: 'actualSupplierChargeCents', title: '实际供应商收费' },
  { key: 'estimatedSupplierChargeCents', title: '预计供应商收费' },
];

const buyGiftPaymentDetailKeys = [
  { key: 'rechargeOrderNo', title: '充值订单号', width: 240 },
  { key: 'userLabel', title: '用户' },
  { key: 'currency', title: '币种' },
  { key: 'paidRechargeAmountCents', title: '充值金额-实收' },
  { key: 'periodCollectionAmountCents', title: '本期收款金额' },
  { key: 'accumulatedCollectionAmountCents', title: '累计收款金额' },
  { key: 'receivableAmountCents', title: '待收金额' },
  { key: 'channelTradeNo', title: '收款渠道流水号', width: 220 },
  { key: 'refundWriteOffPaidCents', title: '退款核销金额-实收(负值)' },
  { key: 'periodRefundPaymentAmountCents', title: '本期退款支付金额(负值)' },
  { key: 'accumulatedRefundPaymentAmountCents', title: '累计退款支付金额(负值)' },
  { key: 'refundChannelTradeNo', title: '退款渠道流水号', width: 220 },
];

const buyGiftPaymentSummaryKeys = [
  { key: 'userLabel', title: '用户' },
  { key: 'userId', title: '用户ID', width: 240 },
  { key: 'currency', title: '币种' },
  { key: 'periodCollectionAmountCents', title: '本期收款金额' },
  { key: 'accumulatedCollectionAmountCents', title: '累计收款金额' },
  { key: 'receivableAmountCents', title: '待收金额' },
  { key: 'periodRefundPaymentAmountCents', title: '本期退款支付金额(负值)' },
  { key: 'accumulatedRefundPaymentAmountCents', title: '累计退款支付金额(负值)' },
];

const enterpriseCreditConsumptionDetailKeys = [
  { key: 'allocationId', title: '消耗分摊ID', width: 240 },
  { key: 'callTime', title: '调用时间', width: 180 },
  { key: 'userLabel', title: '用户' },
  { key: 'workspaceName', title: '企业工作区' },
  { key: 'workspaceId', title: '工作区ID', width: 220 },
  { key: 'model', title: '模型' },
  { key: 'callType', title: '调用类型', width: 220 },
  { key: 'tokenUsage', title: 'Token用量' },
  { key: 'consumedCents', title: '消耗金额' },
  { key: 'recognizedRevenueCents', title: '实付确认收入' },
  { key: 'settledCents', title: '已结算金额' },
  { key: 'outstandingCents', title: '未结算金额' },
  { key: 'settlementStatus', title: '结算状态' },
  { key: 'settledAt', title: '结清时间', width: 180 },
];

const enterpriseCreditConsumptionSummaryKeys = [
  { key: 'workspaceName', title: '企业工作区' },
  { key: 'workspaceId', title: '工作区ID', width: 220 },
  { key: 'workspaceType', title: '工作区类型' },
  { key: 'productName', title: '产品' },
  { key: 'allocationCount', title: '消耗分摊数' },
  { key: 'consumedCents', title: '消耗金额' },
  { key: 'recognizedRevenueCents', title: '实付确认收入' },
  { key: 'settledCents', title: '已结算金额' },
  { key: 'outstandingCents', title: '未结算金额' },
  { key: 'settlementStatus', title: '结算状态' },
];

const enterpriseCreditSettlementKeys = [
  { key: 'settlementId', title: '结算记录ID', width: 240 },
  { key: 'settlementCreatedAt', title: '结算时间', width: 180 },
  { key: 'workspaceName', title: '企业工作区' },
  { key: 'workspaceId', title: '工作区ID', width: 220 },
  { key: 'allocationId', title: '消耗分摊ID', width: 240 },
  { key: 'trigger', title: '结算触发方式' },
  { key: 'amountCents', title: '结算金额' },
  { key: 'paidCents', title: '实付结算金额' },
  { key: 'bonusCents', title: '赠金结算金额' },
  { key: 'repaymentTransactionId', title: '还款流水ID', width: 240 },
  { key: 'repaymentTransactionDescription', title: '还款流水说明', width: 260 },
];

const tokenPlanRevenueSummaryKeys = [
  { key: 'period', title: '账期' },
  { key: 'productName', title: '产品' },
  { key: 'planName', title: '套餐' },
  { key: 'fulfillmentMode', title: '履约模式' },
  { key: 'currency', title: '币种' },
  { key: 'orderCount', title: '订单数' },
  { key: 'lineCount', title: '明细数' },
  { key: 'orderAmountCents', title: '订单净额' },
  { key: 'openingDeferredCents', title: '期初递延收入' },
  { key: 'newDeferredCents', title: '本期新增递延' },
  { key: 'serviceRecognizedRevenueCents', title: '服务期确认收入' },
  { key: 'refundAppliedToDeferredCents', title: '退款冲递延' },
  { key: 'refundRevenueReversalCents', title: '退款冲已确认收入' },
  { key: 'recognizedRevenueCents', title: '本期净确认收入' },
  { key: 'closingDeferredCents', title: '期末递延收入' },
  { key: 'recognizedToDateCents', title: '累计确认收入' },
  { key: 'refundAmountCents', title: '本期退款金额' },
  { key: 'deferredVarianceCents', title: '递延校验差异' },
  { key: 'settlementStatus', title: '状态' },
  { key: 'notes', title: '备注', width: 260 },
];

const tokenPlanRevenueDetailKeys = [
  { key: 'period', title: '账期' },
  { key: 'orderId', title: '订单号', width: 240 },
  { key: 'orderItemId', title: '订单明细ID', width: 240 },
  { key: 'entitlementId', title: '权益ID', width: 240 },
  { key: 'providerEntitlementId', title: '上游权益ID', width: 240 },
  { key: 'userLabel', title: '用户' },
  { key: 'workspaceName', title: '工作区' },
  { key: 'workspaceId', title: '工作区ID', width: 220 },
  { key: 'productName', title: '产品' },
  { key: 'planName', title: '套餐' },
  { key: 'fulfillmentMode', title: '履约模式' },
  { key: 'providerLineCode', title: '供应商线路' },
  { key: 'providerCode', title: '供应商' },
  { key: 'upstreamProductId', title: '上游产品ID', width: 200 },
  { key: 'currency', title: '币种' },
  { key: 'orderAmountCents', title: '订单净额' },
  { key: 'billingPeriod', title: '计费周期' },
  { key: 'serviceStartAt', title: '服务开始', width: 180 },
  { key: 'serviceEndAt', title: '服务结束', width: 180 },
  { key: 'totalServiceDays', title: '总服务天数' },
  { key: 'recognizedDaysInPeriod', title: '本期确认天数' },
  { key: 'openingDeferredCents', title: '期初递延收入' },
  { key: 'newDeferredCents', title: '本期新增递延' },
  { key: 'serviceRecognizedRevenueCents', title: '服务期确认收入' },
  { key: 'refundAppliedToDeferredCents', title: '退款冲递延' },
  { key: 'refundRevenueReversalCents', title: '退款冲已确认收入' },
  { key: 'recognizedRevenueCents', title: '本期净确认收入' },
  { key: 'closingDeferredCents', title: '期末递延收入' },
  { key: 'recognizedToDateCents', title: '累计确认收入' },
  { key: 'refundAmountCents', title: '本期退款金额' },
  { key: 'orderStatus', title: '订单状态' },
  { key: 'entitlementStatus', title: '权益状态' },
  { key: 'evidence', title: '证据来源', width: 300 },
];

const tokenPlanRevenueNoteKeys = [
  { key: 'field', title: '字段' },
  { key: 'status', title: '当前状态' },
  { key: 'note', title: '口径说明', width: 560 },
];

const templateNoteKeys = [
  { key: 'field', title: '字段' },
  { key: 'status', title: '当前状态' },
  { key: 'note', title: '说明', width: 520 },
];

const summaryKeys = [
  { key: 'period', title: '账期月份' },
  { key: 'product', title: '产品' },
  { key: 'billingMode', title: '计费模式' },
  { key: 'currency', title: '币种' },
  { key: 'openingBalanceCents', title: '期初余额' },
  { key: 'rechargeCents', title: '本期充值' },
  { key: 'balanceConsumeCents', title: '本期余额消费' },
  { key: 'refundCents', title: '本期退款' },
  { key: 'adjustCents', title: '手工调整' },
  { key: 'closingBalanceCents', title: '期末余额' },
  { key: 'orderRevenueCents', title: '订单收入' },
  { key: 'quotaGrantedCredits', title: '套餐积分发放' },
  { key: 'bonusGrantedCredits', title: '加油包积分发放' },
  { key: 'creditConsumed', title: '积分消耗' },
  { key: 'apiInputTokens', title: 'API输入Token' },
  { key: 'apiCacheReadInputTokens', title: 'API缓存读取Token' },
  { key: 'apiCacheWriteInputTokens', title: 'API缓存写入Token' },
  { key: 'apiOutputTokens', title: 'API输出Token' },
  { key: 'apiTotalTokens', title: 'API总Token' },
  { key: 'supplierCostCents', title: '供应商成本' },
  { key: 'paymentFeeCents', title: '支付手续费' },
  { key: 'grossProfitCents', title: '毛利' },
  { key: 'invoiceableCents', title: '可开票金额' },
  { key: 'invoicedCents', title: '已开票金额' },
  { key: 'settlementStatus', title: '结算状态' },
  { key: 'varianceCheck', title: '差异检查', width: 280 },
  { key: 'notes', title: '备注', width: 220 },
];

const orderKeys = [
  { key: 'period', title: '账期' },
  { key: 'orderId', title: '订单号', width: 240 },
  { key: 'userLabel', title: '用户' },
  { key: 'workspaceName', title: '工作区' },
  { key: 'workspaceId', title: '工作区ID', width: 220 },
  { key: 'workspaceType', title: '工作区类型' },
  { key: 'productName', title: '产品' },
  { key: 'billingMode', title: '计费模式' },
  { key: 'orderType', title: '订单类型' },
  { key: 'itemName', title: '套餐/加油包' },
  { key: 'originalAmountCents', title: '原价金额' },
  { key: 'discountAmountCents', title: '折扣金额' },
  { key: 'amountCents', title: '实收金额' },
  { key: 'channel', title: '支付渠道' },
  { key: 'tradeNo', title: '支付流水号', width: 220 },
  { key: 'status', title: '订单状态' },
  { key: 'createdAt', title: '创建时间', width: 180 },
  { key: 'paidAt', title: '支付时间', width: 180 },
  { key: 'completedAt', title: '完成时间', width: 180 },
  { key: 'refundedAt', title: '退款时间', width: 180 },
  { key: 'refundAmountCents', title: '退款金额' },
  { key: 'refundReason', title: '退款原因', width: 200 },
  { key: 'invoiceableCents', title: '可开票金额' },
  { key: 'evidence', title: '审计证据', width: 280 },
];

const paymentKeys = [
  { key: 'period', title: '账期' },
  { key: 'channel', title: '支付渠道' },
  { key: 'merchantOrderNo', title: '商户订单号', width: 240 },
  { key: 'tradeNo', title: '系统渠道交易号', width: 220 },
  { key: 'checkoutSessionId', title: 'Stripe Checkout Session ID', width: 240 },
  { key: 'subscriptionId', title: 'Stripe Subscription ID', width: 220 },
  { key: 'invoiceId', title: 'Stripe Invoice ID', width: 220 },
  { key: 'paymentIntentId', title: 'Stripe PaymentIntent ID', width: 220 },
  { key: 'chargeId', title: 'Stripe Charge ID', width: 220 },
  { key: 'balanceTransactionId', title: 'Stripe Balance Transaction ID', width: 240 },
  { key: 'payoutId', title: 'Stripe Payout ID', width: 220 },
  { key: 'userId', title: '用户ID', width: 220 },
  { key: 'workspaceName', title: '工作区' },
  { key: 'workspaceId', title: '工作区ID', width: 220 },
  { key: 'billingMode', title: '计费模式' },
  { key: 'orderType', title: '订单类型' },
  { key: 'paidAmountCents', title: '系统支付金额' },
  { key: 'stripeAmountCents', title: 'Stripe实收金额' },
  { key: 'channelFeeCents', title: '渠道手续费' },
  { key: 'settlementNetCents', title: '渠道结算净额' },
  { key: 'paymentStatus', title: '系统支付状态' },
  { key: 'stripeStatus', title: 'Stripe状态' },
  { key: 'stripeCustomerEmail', title: 'Stripe客户邮箱', width: 220 },
  { key: 'paidAt', title: '支付完成时间', width: 180 },
  { key: 'stripeCreatedAt', title: 'Stripe交易时间', width: 180 },
  { key: 'channelSettlementDate', title: '渠道结算日期' },
  { key: 'bankReceivedDate', title: '银行入账日期' },
  { key: 'webhookEventId', title: 'Webhook/通知ID', width: 220 },
  { key: 'systemMatchStatus', title: '系统匹配状态' },
  { key: 'diffCents', title: '差异金额' },
  { key: 'diffReason', title: '差异原因', width: 220 },
];

const balanceKeys = [
  { key: 'period', title: '账期' },
  { key: 'transactionId', title: '余额流水ID', width: 240 },
  { key: 'userLabel', title: '用户' },
  { key: 'workspaceName', title: '工作区' },
  { key: 'workspaceId', title: '工作区ID', width: 220 },
  { key: 'productName', title: '产品' },
  { key: 'billingMode', title: '计费模式' },
  { key: 'type', title: '流水类型' },
  { key: 'amountCents', title: '变动金额' },
  { key: 'balanceAfterCents', title: '变动后余额' },
  { key: 'orderId', title: '关联订单号', width: 240 },
  { key: 'usageId', title: '关联用量ID' },
  { key: 'description', title: '描述', width: 260 },
  { key: 'createdAt', title: '发生时间', width: 180 },
  { key: 'debitSubjectHint', title: '借方科目建议', width: 180 },
  { key: 'creditSubjectHint', title: '贷方科目建议', width: 180 },
  { key: 'auditNote', title: '审计说明', width: 260 },
];

const balanceGrantKeys = [
  { key: 'period', title: '账期' },
  { key: 'grantId', title: '充值批次ID', width: 240 },
  { key: 'rechargeOrderId', title: '充值订单号', width: 240 },
  { key: 'userLabel', title: '用户' },
  { key: 'workspaceName', title: '工作区' },
  { key: 'workspaceId', title: '工作区ID', width: 220 },
  { key: 'productName', title: '产品' },
  { key: 'billingMode', title: '计费模式' },
  { key: 'source', title: '来源' },
  { key: 'paidCents', title: '实付金额' },
  { key: 'bonusCents', title: '赠额' },
  { key: 'grantedCents', title: '总额度' },
  { key: 'consumedCents', title: '已消耗' },
  { key: 'remainingCents', title: '剩余额度' },
  { key: 'discountRate', title: '折扣率' },
  { key: 'validFrom', title: '生效时间', width: 180 },
  { key: 'expiresAt', title: '到期时间', width: 180 },
  { key: 'isExpired', title: '是否过期' },
  { key: 'createdAt', title: '创建时间', width: 180 },
  { key: 'auditNote', title: '审计说明', width: 280 },
];

const balanceAllocationKeys = [
  { key: 'period', title: '账期' },
  { key: 'allocationId', title: '分摊ID', width: 240 },
  { key: 'transactionId', title: '余额流水ID', width: 240 },
  { key: 'usageId', title: '用量ID', width: 240 },
  { key: 'userLabel', title: '用户' },
  { key: 'workspaceName', title: '工作区' },
  { key: 'workspaceId', title: '工作区ID', width: 220 },
  { key: 'productName', title: '产品' },
  { key: 'billingMode', title: '计费模式' },
  { key: 'rechargeGrantId', title: '充值批次ID', width: 240 },
  { key: 'rechargeOrderId', title: '充值订单号', width: 240 },
  { key: 'consumedCents', title: '本次消耗' },
  { key: 'recognizedRevenueCents', title: '确认收入' },
  { key: 'bonusConsumedCents', title: '赠额消耗' },
  { key: 'discountRate', title: '折扣率' },
  { key: 'grantPaidCents', title: '批次实付' },
  { key: 'grantBonusCents', title: '批次赠额' },
  { key: 'grantTotalCents', title: '批次总额度' },
  { key: 'grantRemainingCents', title: '批次剩余' },
  { key: 'grantSource', title: '批次来源' },
  { key: 'grantExpiresAt', title: '批次到期时间', width: 180 },
  { key: 'transactionDescription', title: '流水描述', width: 260 },
  { key: 'createdAt', title: '分摊时间', width: 180 },
  { key: 'auditNote', title: '审计说明', width: 280 },
];

const creditKeys = [
  { key: 'period', title: '账期' },
  { key: 'transactionId', title: '积分流水ID', width: 240 },
  { key: 'userLabel', title: '用户' },
  { key: 'workspaceName', title: '工作区' },
  { key: 'workspaceId', title: '工作区ID', width: 220 },
  { key: 'subscriptionId', title: '订阅ID', width: 240 },
  { key: 'productName', title: '产品' },
  { key: 'billingMode', title: '计费模式' },
  { key: 'planName', title: '套餐' },
  { key: 'type', title: '流水类型' },
  { key: 'creditsAmount', title: '变动积分' },
  { key: 'quotaAfter', title: '套餐积分余额' },
  { key: 'bonusAfter', title: '加油包积分余额' },
  { key: 'source', title: '来源', width: 220 },
  { key: 'modelName', title: '模型' },
  { key: 'tokenTypeBreakdown', title: 'Token 类型', width: 260 },
  { key: 'regularInputTokens', title: '普通输入Token' },
  { key: 'inputTokens', title: '输入Token' },
  { key: 'cachedInputTokens', title: '缓存读取Token' },
  { key: 'cacheWriteInputTokens', title: '缓存写入Token' },
  { key: 'outputTokens', title: '输出Token' },
  { key: 'totalTokens', title: '总Token' },
  { key: 'requestId', title: '请求ID', width: 200 },
  { key: 'createdAt', title: '发生时间', width: 180 },
  { key: 'orderId', title: '关联订单号', width: 220 },
  { key: 'auditNote', title: '审计说明', width: 240 },
];

const apiUsageKeys = [
  { key: 'createdAt', title: '请求时间', width: 180 },
  { key: 'userLabel', title: '用户' },
  { key: 'workspaceName', title: '工作区' },
  { key: 'workspaceId', title: '工作区ID', width: 220 },
  { key: 'apiKeyPrefix', title: 'API Key' },
  { key: 'model', title: '模型' },
  { key: 'billingMode', title: '计费模式' },
  { key: 'tokenType', title: 'type', width: 130 },
  { key: 'tokens', title: 'tokens' },
  { key: 'unitPriceUsdPerM', title: 'price' },
  { key: 'customerMultiplier', title: '折扣' },
  { key: 'userChargeUsd', title: 'charge' },
  { key: 'paymentDeductionUsd', title: '本金扣费' },
  { key: 'voucherDeductionUsd', title: '赠送扣费' },
  { key: 'creditDeductionUsd', title: '信用扣费' },
  { key: 'debtDeductionUsd', title: '欠费' },
  { key: 'chargeSource', title: '扣费来源' },
  { key: 'usageId', title: '用量ID', width: 240 },
];

const supplierKeys = [
  { key: 'field', title: '供应商成本表必需字段', width: 260 },
  { key: 'status', title: '当前状态' },
  { key: 'action', title: '建议动作', width: 360 },
];

const gapKeys = [
  { key: 'category', title: '类别' },
  { key: 'field', title: '字段/表' },
  { key: 'source', title: '当前系统来源', width: 220 },
  { key: 'availability', title: '当前可用性' },
  { key: 'purpose', title: '用途', width: 260 },
  { key: 'action', title: '建议动作', width: 360 },
];

function getKeys(tab: ReportTab) {
  if (tab === 'pureGiftAccountChanges') return pureGiftAccountChangeKeys;
  if (tab === 'pureGiftConsumptionDetails') return pureGiftConsumptionDetailKeys;
  if (tab === 'pureGiftConsumptionSummary') return pureGiftConsumptionSummaryKeys;
  if (tab === 'buyGiftAccountChanges') return buyGiftAccountChangeKeys;
  if (tab === 'buyGiftAccountSummary') return buyGiftAccountSummaryKeys;
  if (tab === 'buyGiftConsumptionDetails') return buyGiftConsumptionDetailKeys;
  if (tab === 'buyGiftConsumptionSummary') return buyGiftConsumptionSummaryKeys;
  if (tab === 'buyGiftPaymentDetails') return buyGiftPaymentDetailKeys;
  if (tab === 'buyGiftPaymentSummary') return buyGiftPaymentSummaryKeys;
  if (tab === 'enterpriseCreditConsumptionDetails') return enterpriseCreditConsumptionDetailKeys;
  if (tab === 'enterpriseCreditConsumptionSummary') return enterpriseCreditConsumptionSummaryKeys;
  if (tab === 'enterpriseCreditSettlement') return enterpriseCreditSettlementKeys;
  if (tab === 'tokenPlanRevenueSummary') return tokenPlanRevenueSummaryKeys;
  if (tab === 'tokenPlanRevenueDetails') return tokenPlanRevenueDetailKeys;
  if (tab === 'tokenPlanRevenueNotes') return tokenPlanRevenueNoteKeys;
  if (tab === 'templateNotes') return templateNoteKeys;
  if (tab === 'summary') return summaryKeys;
  if (tab === 'orders') return orderKeys;
  if (tab === 'payments') return paymentKeys;
  if (tab === 'balance') return balanceKeys;
  if (tab === 'balanceGrants') return balanceGrantKeys;
  if (tab === 'balanceAllocations') return balanceAllocationKeys;
  if (tab === 'credits') return creditKeys;
  if (tab === 'apiUsage') return apiUsageKeys;
  if (tab === 'supplier') return supplierKeys;
  return gapKeys;
}

function makeReportColumns(
  tab: ReportTab,
  keys: Array<{ key: string; title: string; width?: number }>,
  currency: string,
): ColumnsType<Record<string, unknown>> {
  if (tab === 'templateNotes' || tab === 'tokenPlanRevenueNotes') {
    const noteKeys = tab === 'tokenPlanRevenueNotes' ? tokenPlanRevenueNoteKeys : templateNoteKeys;
    return noteKeys.map((item) => ({
      ...item,
      dataIndex: item.key,
      key: item.key,
      render: (value: unknown, row: Record<string, unknown>) => item.key === 'status'
        ? <Tag color={String(value ?? '').includes('缺失') ? 'orange' : 'gold'}>{String(value ?? '—')}</Tag>
        : renderValue(item.key, value, currency, tab, row),
    })) as ColumnsType<Record<string, unknown>>;
  }
  if (tab === 'gaps') {
    return gapKeys.map((item) => ({
      ...item,
      dataIndex: item.key,
      key: item.key,
      render: (value: unknown, row: Record<string, unknown>) => {
        if (item.key === 'availability') {
          const text = String(value ?? '');
          const color = text.includes('需补') ? 'orange' : text.includes('偏薄') || text.includes('部分') ? 'gold' : 'green';
          return <Tag color={color}>{text}</Tag>;
        }
        if (item.key === 'action' && String(row.availability ?? '').includes('需')) {
          return <span className="finance-report-missing">{String(value ?? '')}</span>;
        }
        return renderValue(item.key, value, currency, tab, row);
      },
    })) as ColumnsType<Record<string, unknown>>;
  }
  if (tab === 'supplier') {
    return supplierKeys.map((item) => ({
      ...item,
      dataIndex: item.key,
      key: item.key,
      render: (value: unknown, row: Record<string, unknown>) => item.key === 'status'
        ? <Tag color="orange">{String(value)}</Tag>
        : renderValue(item.key, value, currency, tab, row),
    })) as ColumnsType<Record<string, unknown>>;
  }
  return makeColumns(keys, currency, tab);
}

function rowKey(row: Record<string, unknown>, index?: number) {
  return String(row.rowId ?? row.allocationId ?? row.grantId ?? row.rechargeBatchNo ?? row.callTransactionNo ?? row.orderItemId ?? row.entitlementId ?? row.orderId ?? row.transactionId ?? row.usageId ?? row.id ?? `${row.period ?? 'row'}-${index ?? 0}`);
}

const reportTabsByMode: Record<ReportMode, Array<{ key: ReportTab; label: string }>> = {
  pureGift: [
    { key: 'pureGiftAccountChanges', label: '账户变动明细' },
    { key: 'pureGiftConsumptionDetails', label: '当期消耗明细' },
    { key: 'pureGiftConsumptionSummary', label: '当期消耗汇总' },
    { key: 'templateNotes', label: '字段口径' },
  ],
  buyGift: [
    { key: 'buyGiftAccountChanges', label: '账户变动明细' },
    { key: 'buyGiftAccountSummary', label: '账户变动汇总' },
    { key: 'buyGiftConsumptionDetails', label: '当期消耗明细' },
    { key: 'buyGiftConsumptionSummary', label: '当期消耗汇总' },
    { key: 'templateNotes', label: '字段口径' },
  ],
  enterpriseCredit: [
    { key: 'enterpriseCreditConsumptionDetails', label: '消耗明细' },
    { key: 'enterpriseCreditConsumptionSummary', label: '消耗汇总' },
    { key: 'enterpriseCreditSettlement', label: '结算对账' },
  ],
  subscription: [
    { key: 'tokenPlanRevenueSummary', label: '收入确认汇总' },
    { key: 'tokenPlanRevenueDetails', label: '收入确认明细' },
    { key: 'orders', label: '收入订单明细' },
    { key: 'payments', label: '收款渠道对账' },
    { key: 'credits', label: '积分流水' },
    { key: 'apiUsage', label: 'API 用量' },
    { key: 'tokenPlanRevenueNotes', label: '口径说明' },
  ],
  tokenPlan: [
    { key: 'tokenPlanRevenueSummary', label: '收入确认汇总' },
    { key: 'tokenPlanRevenueDetails', label: '收入确认明细' },
    { key: 'orders', label: '收入订单明细' },
    { key: 'payments', label: '收款渠道对账' },
    { key: 'credits', label: '积分流水' },
    { key: 'apiUsage', label: 'API 用量' },
    { key: 'tokenPlanRevenueNotes', label: '口径说明' },
  ],
  audit: [
    { key: 'summary', label: '月度对账汇总' },
    { key: 'orders', label: '收入订单明细' },
    { key: 'payments', label: '收款渠道对账' },
    { key: 'balance', label: '余额流水明细' },
    { key: 'balanceGrants', label: '充值批次' },
    { key: 'balanceAllocations', label: '余额消耗分摊' },
    { key: 'credits', label: '积分套餐流水' },
    { key: 'apiUsage', label: 'API 用量扣费' },
    { key: 'supplier', label: '供应商成本' },
    { key: 'gaps', label: '字段映射与缺口' },
  ],
};

const defaultTabByMode: Record<ReportMode, ReportTab> = {
  pureGift: 'pureGiftAccountChanges',
  buyGift: 'buyGiftAccountChanges',
  enterpriseCredit: 'enterpriseCreditConsumptionDetails',
  subscription: 'tokenPlanRevenueSummary',
  tokenPlan: 'tokenPlanRevenueSummary',
  audit: 'summary',
};

const billingModeByReportMode: Record<ReportMode, BillingModeFilter> = {
  pureGift: 'PAY_AS_YOU_GO',
  buyGift: 'PAY_AS_YOU_GO',
  enterpriseCredit: 'PAY_AS_YOU_GO',
  subscription: 'SUBSCRIPTION',
  tokenPlan: 'CODING_PLAN',
  audit: 'ALL',
};

const DEFAULT_DETAIL_PAGE_SIZE = 20;
const DETAIL_PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50, 100] as const;

interface FinanceReportQueryState {
  month: string;
  filterField?: FinanceReportFilterField;
  filterValue: string;
}

function createFinanceReportQueryState(
  month: string,
  tab: ReportTab,
): FinanceReportQueryState {
  return {
    month,
    filterField: defaultFinanceReportFilterField(tab),
    filterValue: '',
  };
}

function isSameFinanceReportQuery(
  left: FinanceReportQueryState,
  right: FinanceReportQueryState,
): boolean {
  return left.month === right.month
    && left.filterField === right.filterField
    && left.filterValue === right.filterValue;
}

export function FinanceReportsPage({ variant = 'reports' }: { variant?: FinancePageVariant }) {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const platformCurrency = usePlatformCurrency();
  const canExport = usePermission(
    variant === 'reconciliation'
      ? 'admin.page.finance_reconciliation.export'
      : 'admin.page.finance_reports.export',
  );
  const initialMonth = useRef(dayjs().format('YYYY-MM')).current;
  const initialReportMode: ReportMode = variant === 'reconciliation' ? 'audit' : 'pureGift';
  const initialTab = defaultTabByMode[initialReportMode];
  const [reportMode, setReportMode] = useState<ReportMode>(initialReportMode);
  const [reconciliationBillingMode, setReconciliationBillingMode] = useState<BillingModeFilter>('ALL');
  const [activeTab, setActiveTab] = useState<ReportTab>(initialTab);
  const [draftQuery, setDraftQuery] = useState<FinanceReportQueryState>(
    () => createFinanceReportQueryState(initialMonth, initialTab),
  );
  const [appliedQuery, setAppliedQuery] = useState<FinanceReportQueryState>(
    () => createFinanceReportQueryState(initialMonth, initialTab),
  );
  const [detailPageSize, setDetailPageSize] = useState(DEFAULT_DETAIL_PAGE_SIZE);
  const [data, setData] = useState<FinanceReportData | null>(null);
  const [detail, setDetail] = useState<FinanceReportDetailData | null>(null);
  const overviewRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [detailCursor, setDetailCursor] = useState<string | undefined>();
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>([]);
  const [pageIndex, setPageIndex] = useState(1);
  const effectiveReportMode = variant === 'reconciliation' ? 'audit' : reportMode;
  const billingMode = variant === 'reconciliation'
    ? reconciliationBillingMode
    : billingModeByReportMode[effectiveReportMode];
  const billingModeParam = billingMode === 'ALL' ? undefined : billingMode;
  const filterOptions = useMemo(
    () => getFinanceReportFilterOptions(activeTab),
    [activeTab],
  );
  const appliedFilterValue = appliedQuery.filterValue.trim();
  const appliedFilterField = appliedFilterValue
    && isFinanceReportFilterAllowed(activeTab, appliedQuery.filterField)
    ? appliedQuery.filterField
    : undefined;

  const loadOverview = useCallback((refreshCache = false) => {
    const requestId = overviewRequestRef.current + 1;
    overviewRequestRef.current = requestId;
    setData(null);
    setOverviewLoading(true);
    financeReportsApi
      .overview({
        month: appliedQuery.month,
        billingMode: billingModeParam,
        ...(refreshCache ? { refresh: true } : {}),
      })
      .then((nextData: FinanceReportData) => {
        if (requestId === overviewRequestRef.current) setData(nextData);
      })
      .catch(() => {
        if (requestId !== overviewRequestRef.current) return;
        message.error('财务报表概览加载失败');
        setData(null);
      })
      .finally(() => {
        if (requestId === overviewRequestRef.current) setOverviewLoading(false);
      });
  }, [appliedQuery.month, billingModeParam, message]);

  const loadDetailPage = useCallback((
    cursor?: string,
    nextHistory: Array<string | undefined> = [],
    nextPageIndex = 1,
  ) => {
    if (activeTab === 'summary') {
      setDetail(null);
      setDetailLoading(false);
      setDetailCursor(undefined);
      setCursorHistory([]);
      setPageIndex(1);
      return;
    }
    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;
    setDetailLoading(true);
    financeReportsApi
      .detail({
        month: appliedQuery.month,
        tab: activeTab,
        billingMode: billingModeParam,
        pageSize: detailPageSize,
        cursor,
        filterField: appliedFilterField,
        filterValue: appliedFilterField ? appliedFilterValue : undefined,
      })
      .then((nextDetail: FinanceReportDetailData) => {
        if (requestId !== detailRequestRef.current) return;
        setDetail(nextDetail);
        setDetailCursor(cursor);
        setCursorHistory(nextHistory);
        setPageIndex(nextPageIndex);
      })
      .catch(() => {
        if (requestId !== detailRequestRef.current) return;
        message.error('财务报表明细加载失败');
        setDetail(null);
      })
      .finally(() => {
        if (requestId === detailRequestRef.current) setDetailLoading(false);
      });
  }, [
    activeTab,
    appliedFilterField,
    appliedFilterValue,
    appliedQuery.month,
    billingModeParam,
    detailPageSize,
    message,
  ]);

  const resetDetailPageState = useCallback(() => {
    detailRequestRef.current += 1;
    setDetail(null);
    setDetailLoading(false);
    setDetailCursor(undefined);
    setCursorHistory([]);
    setPageIndex(1);
  }, []);

  const resetOverviewState = useCallback(() => {
    overviewRequestRef.current += 1;
    setData(null);
    setOverviewLoading(false);
  }, []);

  const refresh = useCallback(() => {
    setDraftQuery(appliedQuery);
    resetDetailPageState();
    loadOverview(true);
    loadDetailPage(undefined, [], 1);
  }, [appliedQuery, loadDetailPage, loadOverview, resetDetailPageState]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    resetDetailPageState();
    loadDetailPage(undefined, [], 1);
  }, [loadDetailPage, resetDetailPageState]);

  const visibleDetail = useMemo<FinanceReportDetailData | null>(() => {
    if (activeTab === 'summary' && data) {
      return {
        period: data.period,
        tab: 'summary',
        rows: data.monthlySummary,
        pagination: {
          mode: 'static',
          pageSize: Math.max(1, data.monthlySummary.length),
          hasMore: false,
          nextCursor: null,
          rowsReturned: data.monthlySummary.length,
        },
      };
    }
    return detail?.tab === activeTab ? detail : null;
  }, [activeTab, data, detail]);
  const rows = visibleDetail?.rows ?? [];
  const currentDetailLoading = activeTab === 'summary' ? overviewLoading : detailLoading;
  const loading = overviewLoading || currentDetailLoading;
  const isRevenueRecognitionMode = effectiveReportMode === 'subscription' || effectiveReportMode === 'tokenPlan';
  const asOfLabel = formatFinanceReportAsOf(visibleDetail?.period);

  const handleExport = () => {
    setExportLoading(true);
    financeReportsApi
      .createExportJob({
        month: appliedQuery.month,
        tab: activeTab,
        billingMode: billingModeParam,
      })
      .then((job: FinanceExportJob) => {
        message.success(`已创建导出任务：${job.filename}`);
        navigate('/finance-export-jobs');
      })
      .catch((error: { response?: { data?: { message?: string } } }) => {
        message.error(error?.response?.data?.message ?? '创建导出任务失败');
      })
      .finally(() => setExportLoading(false));
  };

  const applyQuery = () => {
    const filterValue = draftQuery.filterValue.trim();
    const filterField = filterValue
      && isFinanceReportFilterAllowed(activeTab, draftQuery.filterField)
      ? draftQuery.filterField
      : defaultFinanceReportFilterField(activeTab);
    const nextQuery: FinanceReportQueryState = {
      month: draftQuery.month,
      filterField,
      filterValue,
    };
    setDraftQuery(nextQuery);
    if (isSameFinanceReportQuery(appliedQuery, nextQuery)) {
      resetDetailPageState();
      loadOverview();
      loadDetailPage(undefined, [], 1);
      return;
    }
    resetDetailPageState();
    if (nextQuery.month !== appliedQuery.month) resetOverviewState();
    setAppliedQuery(nextQuery);
  };

  const clearFilter = () => {
    const nextAppliedQuery = createFinanceReportQueryState(appliedQuery.month, activeTab);
    setDraftQuery((current) => ({
      ...current,
      filterField: nextAppliedQuery.filterField,
      filterValue: '',
    }));
    if (isSameFinanceReportQuery(appliedQuery, nextAppliedQuery)) {
      return;
    }
    resetDetailPageState();
    setAppliedQuery(nextAppliedQuery);
  };

  const resetFiltersForTab = (tab: ReportTab) => {
    const nextQuery = createFinanceReportQueryState(appliedQuery.month, tab);
    resetDetailPageState();
    setDraftQuery(nextQuery);
    setAppliedQuery(nextQuery);
  };

  const handleReportModeChange = (nextMode: ReportMode) => {
    const nextTab = defaultTabByMode[nextMode];
    setReportMode(nextMode);
    setActiveTab(nextTab);
    resetFiltersForTab(nextTab);
  };

  const handleTabChange = (nextTab: ReportTab) => {
    setActiveTab(nextTab);
    resetFiltersForTab(nextTab);
  };

  const handleBillingModeChange = (nextBillingMode: BillingModeFilter) => {
    resetOverviewState();
    resetDetailPageState();
    setReconciliationBillingMode(nextBillingMode);
  };

  const handlePageSizeChange = (nextPageSize: number) => {
    if (nextPageSize === detailPageSize) return;
    resetDetailPageState();
    setDetailPageSize(nextPageSize);
  };

  const handleNextPage = () => {
    const nextCursor = visibleDetail?.pagination.nextCursor;
    if (!nextCursor) return;
    loadDetailPage(nextCursor, [...cursorHistory, detailCursor], pageIndex + 1);
  };

  const handlePrevPage = () => {
    if (cursorHistory.length === 0) return;
    const nextHistory = cursorHistory.slice(0, -1);
    const previousCursor = cursorHistory[cursorHistory.length - 1];
    loadDetailPage(previousCursor, nextHistory, Math.max(1, pageIndex - 1));
  };

  return (
    <div className="finance-reports">
      <PageHeader
        title={variant === 'reconciliation' ? '财务对账' : '财务报表'}
        actions={[
          <Button key="reload" icon={<ReloadOutlined />} onClick={refresh} loading={loading}>
            刷新
          </Button>,
          ...(canExport ? [
            <Button
              key="export"
              type="primary"
              icon={<CloudDownloadOutlined />}
              onClick={handleExport}
              loading={exportLoading}
              disabled={draftQuery.month !== appliedQuery.month}
              title={draftQuery.month === appliedQuery.month
                ? '导出当前账期全部数据，不包含页面筛选条件'
                : '请先点击查询，应用新账期后再导出'}
            >
              导出当前账期全部数据
            </Button>,
          ] : []),
        ]}
      />

      <div className="finance-reports-toolbar">
        <div className="finance-report-toolbar-left">
          {variant === 'reconciliation' ? (
            <Segmented
              value={reconciliationBillingMode}
              onChange={(value) => handleBillingModeChange(value as BillingModeFilter)}
              options={[
                { label: '全部', value: 'ALL' },
                { label: '订阅', value: 'SUBSCRIPTION' },
                { label: '按量', value: 'PAY_AS_YOU_GO' },
                { label: 'CodingPlan', value: 'CODING_PLAN' },
              ]}
            />
          ) : (
            <Segmented
              value={reportMode}
              onChange={(value) => handleReportModeChange(value as ReportMode)}
              options={[
                { label: '按量纯赠', value: 'pureGift' },
                { label: '按量买赠', value: 'buyGift' },
                { label: '企业信用', value: 'enterpriseCredit' },
                { label: '订阅收入', value: 'subscription' },
                { label: 'CodingPlan收入', value: 'tokenPlan' },
              ]}
            />
          )}
        </div>
      </div>

      <StatCardGroup columns={5}>
        <StatCard
          label={isRevenueRecognitionMode ? '确认收入' : '订单收入'}
          value={formatMoney(
            isRevenueRecognitionMode
              ? data?.metrics.tokenPlanRecognizedRevenueCents
              : data?.metrics.orderRevenueCents,
            platformCurrency,
          )}
        />
        <StatCard label="本期充值" value={formatMoney(data?.metrics.rechargeCents, platformCurrency)} variant="success" />
        <StatCard
          label={isRevenueRecognitionMode ? '递延余额' : '余额消费'}
          value={formatMoney(
            isRevenueRecognitionMode
              ? data?.metrics.tokenPlanClosingDeferredCents
              : data?.metrics.balanceConsumeCents,
            platformCurrency,
          )}
          variant="warning"
        />
        <StatCard label="API 用量记录" value={data?.metrics.tokenUsageCount ?? '—'} />
        <StatCard label="总 Token" value={formatNumber(data?.metrics.totalTokens)} />
      </StatCardGroup>

      <div className="finance-report-panel">
        <FinanceReportQueryBar
          month={draftQuery.month}
          filterOptions={filterOptions}
          filterField={draftQuery.filterField}
          filterValue={draftQuery.filterValue}
          loading={loading}
          hasAppliedFilter={Boolean(appliedFilterField)}
          onMonthChange={(month) => setDraftQuery((current) => ({ ...current, month }))}
          onFilterFieldChange={(filterField) => {
            setDraftQuery((current) => ({ ...current, filterField, filterValue: '' }));
          }}
          onFilterValueChange={(filterValue) => {
            setDraftQuery((current) => ({ ...current, filterValue }));
          }}
          onQuery={applyQuery}
          onClearFilter={clearFilter}
        />
        <Tabs
          className="finance-report-tabs"
          activeKey={activeTab}
          destroyOnHidden
          onChange={(key) => handleTabChange(key as ReportTab)}
          items={reportTabsByMode[effectiveReportMode].map((tab) => {
            const tabKeys = getKeys(tab.key);
            const tabColumns = makeReportColumns(tab.key, tabKeys, platformCurrency);
            const tableRows = tab.key === activeTab ? rows : [];
            return {
              ...tab,
              children: (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {tab.key === activeTab && asOfLabel ? (
                  <Typography.Text type="secondary" className="finance-report-as-of">
                    {asOfLabel}
                  </Typography.Text>
                ) : null}
                <DataTable
                  className="finance-report-table"
                  columns={tabColumns}
                  dataSource={tableRows}
                  rowKey={rowKey}
                  loading={tab.key === activeTab ? currentDetailLoading : false}
                  size="small"
                  scroll={{ x: 'max-content' }}
                  pagination={false}
                />
                {tab.key === activeTab && (
                  <div className="finance-report-pagination">
                    <Space>
                    <Button onClick={handlePrevPage} disabled={currentDetailLoading || cursorHistory.length === 0}>
                      上一页
                    </Button>
                    <Typography.Text type="secondary">
                      第 {pageIndex} 页 · 当前页 {rows.length} 行{visibleDetail?.pagination.hasMore ? '' : ' · 已到末页'}
                    </Typography.Text>
                    <Button onClick={handleNextPage} disabled={currentDetailLoading || !visibleDetail?.pagination.hasMore}>
                      下一页
                    </Button>
                    </Space>
                    <Space>
                      <Typography.Text type="secondary">每页</Typography.Text>
                      <Select
                        aria-label="每页展示数量"
                        value={detailPageSize}
                        options={DETAIL_PAGE_SIZE_OPTIONS.map((value) => ({
                          label: String(value),
                          value,
                        }))}
                        onChange={handlePageSizeChange}
                        className="finance-report-page-size"
                      />
                      <Typography.Text type="secondary">条</Typography.Text>
                    </Space>
                  </div>
                )}
              </Space>
              ),
            };
          })}
        />
      </div>
    </div>
  );
}

export default function DefaultFinanceReportsPage() {
  return <FinanceReportsPage />;
}
