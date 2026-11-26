import { Form } from 'antd';
import { StableNumberInput } from '../../../components/common';
import type { PlanDetailChange, PlanDetailState } from '../types';

interface Props {
  plan: PlanDetailState;
  onChange: PlanDetailChange;
  canManage?: boolean;
}

export function TeamTab({ plan, onChange, canManage = true }: Props) {
  return (
    <div>
      <Form
        layout="vertical"
        initialValues={plan}
        disabled={!canManage}
        onValuesChange={(_, values) => onChange({ ...plan, ...values })}
      >
        <Form.Item label="成员上限" name="memberLimit" tooltip="单个订阅可添加的成员数">
          <StableNumberInput min={1} precision={0} addonAfter="人" style={{ width: 240 }} />
        </Form.Item>
        <Form.Item label="最低席位" name="minimumSeats" tooltip="购买时的最低席位数">
          <StableNumberInput min={1} precision={0} addonAfter="人" style={{ width: 240 }} />
        </Form.Item>
      </Form>
    </div>
  );
}
