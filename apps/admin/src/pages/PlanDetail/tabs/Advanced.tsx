import { Form, Select, Switch } from 'antd';
import { StableNumberInput } from '../../../components/common';
import type { PlanDetailChange, PlanDetailState } from '../types';

interface Props {
  plan: PlanDetailState;
  onChange: PlanDetailChange;
  canManage?: boolean;
}

export function AdvancedTab({ plan, onChange, canManage = true }: Props) {
  return (
    <Form
      layout="vertical"
      initialValues={plan}
      disabled={!canManage}
      onValuesChange={(_, values) => onChange({ ...plan, ...values })}
    >
      <Form.Item label="超额使用" name="overageEnabled" valuePropName="checked" tooltip="积分用完后按量续费">
        <Switch />
      </Form.Item>
      <Form.Item
        label="用量倍率"
        name="usageMultiplier"
        tooltip="免费 2.0× / 入门 1.2× / 专业 1.0× / 旗舰 0.9×。>1 多扣积分, <1 折扣"
      >
        <StableNumberInput min={0.1} max={10} step={0.1} precision={3} style={{ width: 240 }} />
      </Form.Item>
      <Form.Item label="数据训练策略" name="dataTraining">
        <Select
          style={{ width: 240 }}
          options={[
            { value: 'opt_out', label: '默认不参与' },
            { value: 'opt_in', label: '默认参与' },
            { value: 'never', label: '永不参与' },
          ]}
        />
      </Form.Item>
      <Form.Item label="支持等级" name="supportTier">
        <Select
          style={{ width: 240 }}
          options={[
            { value: 'community', label: '社区' },
            { value: 'standard', label: '标准' },
            { value: 'priority', label: '优先' },
            { value: 'dedicated', label: '专属' },
          ]}
        />
      </Form.Item>
      <Form.Item label="SSO 单点登录" name="ssoEnabled" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item label="优先访问" name="priorityAccess" valuePropName="checked" tooltip="新模型上线时优先体验">
        <Switch />
      </Form.Item>
      {/* TODO(Phase-3): 自动续费 / 退款策略 字段待 schema 扩展 */}
    </Form>
  );
}
