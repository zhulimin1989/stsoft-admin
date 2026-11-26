import { Alert, Form, Input, Modal, Radio, Select, Space, Typography } from 'antd';
import type { BalanceAdjustmentReasonCode } from '../../api/admin';
import { StableNumberInput } from './StableNumberInput';

export interface BalanceAdjustmentFormValues {
  direction: 'CREDIT' | 'DEBIT';
  amount: number;
  reasonCode: BalanceAdjustmentReasonCode;
  description: string;
}

interface BalanceAdjustmentModalProps {
  open: boolean;
  loading: boolean;
  entityLabel: string;
  currencyCode: string;
  currentBalanceCents?: number | null;
  onSubmit: (values: BalanceAdjustmentFormValues) => void | Promise<void>;
  onCancel: () => void;
}

const REASON_OPTIONS: Array<{ label: string; value: BalanceAdjustmentReasonCode }> = [
  { label: '折扣配置纠正', value: 'DISCOUNT_CORRECTION' },
  { label: '计费数据纠正', value: 'BILLING_CORRECTION' },
  { label: '服务补偿', value: 'SERVICE_COMPENSATION' },
  { label: '其他', value: 'OTHER' },
];

export function BalanceAdjustmentModal({
  open,
  loading,
  entityLabel,
  currencyCode,
  currentBalanceCents,
  onSubmit,
  onCancel,
}: BalanceAdjustmentModalProps) {
  const [form] = Form.useForm<BalanceAdjustmentFormValues>();
  const direction = Form.useWatch('direction', form) ?? 'CREDIT';
  const normalizedCurrency = currencyCode.toUpperCase();

  return (
    <Modal
      title="调整余额"
      open={open}
      confirmLoading={loading}
      okText="确认调整"
      cancelText="取消"
      destroyOnClose
      onCancel={onCancel}
      onOk={() => void form.validateFields().then(onSubmit)}
      afterClose={() => form.resetFields()}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Typography.Text type="secondary">
          调整对象：{entityLabel}
          {typeof currentBalanceCents === 'number'
            ? ` · 当前余额 ${(currentBalanceCents / 100).toFixed(2)} ${normalizedCurrency}`
            : ''}
        </Typography.Text>
        <Alert
          showIcon
          type={direction === 'CREDIT' ? 'info' : 'warning'}
          message={direction === 'CREDIT' ? '增加的是非现金调整额度' : '减少将生成本期消费流水'}
          description={
            direction === 'CREDIT'
              ? '可用于后续按量消费，不属于现金充值，不可提现或退款。'
              : '不会改写历史账单；可用余额或企业信用不足时，调整会失败。'
          }
        />
        <Form
          form={form}
          layout="vertical"
          initialValues={{ direction: 'CREDIT', reasonCode: 'DISCOUNT_CORRECTION' }}
          style={{ width: '100%' }}
        >
          <Form.Item name="direction" label="调整方向" rules={[{ required: true }]}>
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              options={[
                { label: '增加余额', value: 'CREDIT' },
                { label: '减少余额', value: 'DEBIT' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="amount"
            label={`调整金额（${normalizedCurrency}）`}
            rules={[
              { required: true, message: '请输入调整金额' },
              {
                validator: (_, value) =>
                  typeof value === 'number' && value > 0 && value <= 25_000
                    ? Promise.resolve()
                    : Promise.reject(new Error('金额必须大于 0 且不超过 25,000')),
              },
            ]}
          >
            <StableNumberInput min={0.01} max={25_000} precision={2} placeholder="0.00" />
          </Form.Item>
          <Form.Item name="reasonCode" label="调整原因" rules={[{ required: true }]}>
            <Select options={REASON_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="description"
            label="调整说明"
            rules={[
              { required: true, whitespace: true, message: '请填写可供审计的调整说明' },
              { max: 500, message: '调整说明不能超过 500 个字符' },
            ]}
          >
            <Input.TextArea rows={3} placeholder="例如：2026-08 结算折扣配置纠正，关联工单/账单号…" />
          </Form.Item>
        </Form>
      </Space>
    </Modal>
  );
}
