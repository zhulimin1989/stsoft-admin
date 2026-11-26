import { describe, expect, it } from 'vitest';
import {
  defaultFinanceReportFilterField,
  getFinanceReportFilterOptions,
  isFinanceReportFilterAllowed,
} from '../financeReportFilters';

describe('finance report filter configuration', () => {
  it('exposes only business-relevant fields for each report tab', () => {
    expect(getFinanceReportFilterOptions('pureGiftConsumptionDetails').map(
      (item) => item.value,
    )).toEqual(['user', 'model', 'callTransactionNo', 'rechargeBatchNo']);
    expect(getFinanceReportFilterOptions('balanceAllocations').map(
      (item) => item.value,
    )).toEqual([
      'user',
      'workspace',
      'allocationId',
      'usageId',
      'grantId',
      'rechargeOrderNo',
    ]);
    expect(getFinanceReportFilterOptions('credits').map(
      (item) => item.value,
    )).toEqual(['user', 'workspace', 'model', 'transactionId', 'requestId']);
    expect(defaultFinanceReportFilterField('apiUsage')).toBe('user');
    expect(getFinanceReportFilterOptions('apiUsage')[0]?.placeholder).toBe(
      '请输入用户 ID、邮箱、手机号或认证企业名称',
    );
  });

  it('does not expose search controls for static explanatory tabs', () => {
    for (const tab of ['summary', 'templateNotes', 'tokenPlanRevenueNotes', 'supplier', 'gaps'] as const) {
      expect(getFinanceReportFilterOptions(tab)).toEqual([]);
      expect(defaultFinanceReportFilterField(tab)).toBeUndefined();
    }
  });

  it('rejects a field that is not whitelisted for the active tab', () => {
    expect(isFinanceReportFilterAllowed('pureGiftAccountChanges', 'rechargeBatchNo')).toBe(true);
    expect(isFinanceReportFilterAllowed('pureGiftAccountChanges', 'model')).toBe(false);
    expect(isFinanceReportFilterAllowed('templateNotes', 'user')).toBe(false);
  });
});
