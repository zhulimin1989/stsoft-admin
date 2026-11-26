import { Button, Form, Select, Space } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';

export type ProtocolPathValue = {
  inbound_protocol?: string;
  channel?: string;
};

type ProtocolPathListProps = {
  name: string | Array<string | number>;
  label?: string;
  inboundProtocolOptions: Array<{ value: string; label: string; disabled?: boolean }>;
  channelOptions: Array<{ value: string; label: string; disabled?: boolean }>;
  upstreamProtocol?: string | null;
  addText?: string;
};

function fieldPath(name: ProtocolPathListProps['name'], ...parts: Array<string | number>): Array<string | number> {
  return [...(Array.isArray(name) ? name : [name]), ...parts];
}

export function suggestedProtocolChannel(
  upstreamProtocol: string | null | undefined,
  inboundProtocol: string | null | undefined,
): string {
  if (upstreamProtocol && inboundProtocol && upstreamProtocol === inboundProtocol) return 'passthrough';
  if (upstreamProtocol === 'openai' && inboundProtocol === 'responses') return 'responses_to_chat';
  if (upstreamProtocol === 'openai' && inboundProtocol === 'anthropic') return 'anthropic_to_chat';
  return 'passthrough';
}

export function ProtocolPathList({
  name,
  label = '路径列表',
  inboundProtocolOptions,
  channelOptions,
  upstreamProtocol,
  addText = '添加路径',
}: ProtocolPathListProps) {
  const form = Form.useFormInstance();
  const firstInbound = inboundProtocolOptions.find((option) => !option.disabled)?.value ?? 'openai';

  return (
    <Form.List name={name}>
      {(fields, { add, remove }) => (
        <div className="protocol-path-list">
          <div
            className="protocol-path-list__header"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: 8,
            }}
          >
            <span>{label}</span>
            <Button
              size="small"
              icon={<PlusOutlined />}
              onClick={() => add({
                inbound_protocol: firstInbound,
                channel: suggestedProtocolChannel(upstreamProtocol, firstInbound),
              })}
            >
              {addText}
            </Button>
          </div>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {fields.map((field) => (
              <Space key={field.key} align="baseline" size={8} wrap>
                <Form.Item
                  name={[field.name, 'inbound_protocol']}
                  rules={[{ required: true, message: '请选择下游协议' }]}
                >
                  <Select
                    style={{ width: 180 }}
                    options={inboundProtocolOptions}
                    placeholder="下游协议"
                    onChange={(value) => {
                      form.setFieldValue(
                        fieldPath(name, field.name, 'channel'),
                        suggestedProtocolChannel(upstreamProtocol, value),
                      );
                    }}
                  />
                </Form.Item>
                <Form.Item
                  name={[field.name, 'channel']}
                  rules={[{ required: true, message: '请选择 channel' }]}
                >
                  <Select
                    style={{ width: 220 }}
                    options={channelOptions}
                    placeholder="channel"
                  />
                </Form.Item>
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => remove(field.name)}
                />
              </Space>
            ))}
          </Space>
        </div>
      )}
    </Form.List>
  );
}
