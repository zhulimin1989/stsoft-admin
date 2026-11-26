import { Alert, Collapse, Descriptions, Space, Typography } from 'antd';
import type { GatewayUsagePlatformLossRow } from '../../api/admin';
import { formatExactDecimal } from '../FinanceReports/formatters';

const { Text } = Typography;

function exactMoney(value: string, currency?: string | null): string {
  const amount = formatExactDecimal(value);
  return amount === '—' ? amount : `${currency || '平台币种'} ${amount}`;
}

function AuditId({ value }: { value: string }) {
  return <Text code copyable>{value}</Text>;
}

function PlatformLossFact({
  loss,
  currency,
}: {
  loss: GatewayUsagePlatformLossRow;
  currency?: string | null;
}) {
  const customerDeduction = formatExactDecimal(loss.customerDeductionUsd);
  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <Alert
        type={customerDeduction === '0' ? 'success' : 'error'}
        showIcon
        message={customerDeduction === '0'
          ? '客户补扣为 0；该差额由平台吸收'
          : '审计异常：客户补扣不是 0'}
      />
      <Descriptions bordered size="small" column={2}>
        <Descriptions.Item label="客户原金额">
          {exactMoney(loss.customerChargeBeforeUsd, currency)}
        </Descriptions.Item>
        <Descriptions.Item label="客户修正金额">
          {exactMoney(loss.customerChargeCorrectedUsd, currency)}
        </Descriptions.Item>
        <Descriptions.Item label="平台吸收客户差额">
          {exactMoney(loss.absorbedCustomerChargeUsd, currency)}
        </Descriptions.Item>
        <Descriptions.Item label="客户实际补扣">
          {exactMoney(loss.customerDeductionUsd, currency)}
        </Descriptions.Item>
        <Descriptions.Item label="供应商原成本">
          {exactMoney(loss.providerCostBeforeUsd, currency)}
        </Descriptions.Item>
        <Descriptions.Item label="供应商修正成本">
          {exactMoney(loss.providerCostCorrectedUsd, currency)}
        </Descriptions.Item>
        <Descriptions.Item label="供应商成本差额">
          {exactMoney(loss.providerCostDeltaUsd, currency)}
        </Descriptions.Item>
        <Descriptions.Item label="平台损失">
          {exactMoney(loss.platformLossUsd, currency)}
        </Descriptions.Item>
        <Descriptions.Item label="平台损失 ID" span={2}>
          <AuditId value={loss.id} />
        </Descriptions.Item>
        <Descriptions.Item label="Correction evidence ID" span={2}>
          <AuditId value={loss.correctionEvidenceId} />
        </Descriptions.Item>
        <Descriptions.Item label="Correction evidence hash" span={2}>
          <AuditId value={loss.correctionEvidenceHash} />
        </Descriptions.Item>
        <Descriptions.Item label="Reconciliation action ID" span={2}>
          <AuditId value={loss.reconciliationActionId} />
        </Descriptions.Item>
        <Descriptions.Item label="原结算 receipt ID" span={2}>
          <AuditId value={loss.originalSettlementReceiptId} />
        </Descriptions.Item>
        <Descriptions.Item label="吸收 receipt ID" span={2}>
          <AuditId value={loss.absorptionSettlementReceiptId} />
        </Descriptions.Item>
        <Descriptions.Item label="计价策略">
          <AuditId value={loss.valuationPolicyVersion} />
        </Descriptions.Item>
        <Descriptions.Item label="Billing unit">
          {loss.billingUnit}
        </Descriptions.Item>
        <Descriptions.Item label="操作者">
          <AuditId value={loss.actorId} />
        </Descriptions.Item>
        <Descriptions.Item label="发生时间">
          {loss.createdAt}
        </Descriptions.Item>
        <Descriptions.Item label="原因" span={2}>
          {loss.reason}
        </Descriptions.Item>
        <Descriptions.Item label="幂等键" span={2}>
          <AuditId value={loss.idempotencyKey} />
        </Descriptions.Item>
      </Descriptions>
    </Space>
  );
}

export function GatewayPlatformLossDetails({
  entries,
  currency,
}: {
  entries?: GatewayUsagePlatformLossRow[] | null;
  currency?: string | null;
}) {
  if (!entries?.length) {
    return (
      <Alert
        type="info"
        showIcon
        message="该事件没有逐请求平台损失记录"
      />
    );
  }

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Text type="secondary">
        以下为 Billing 永久写入的只读差额事实；金额按字符串精确展示，不做浮点转换。
      </Text>
      <Collapse
        defaultActiveKey={[entries[0].id]}
        items={entries.map((loss, index) => ({
          key: loss.id,
          label: `平台损失 ${index + 1} · ${loss.id}`,
          children: <PlatformLossFact loss={loss} currency={currency} />,
        }))}
      />
    </Space>
  );
}
