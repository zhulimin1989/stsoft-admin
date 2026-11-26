import { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Button, Drawer, Form, Input, Select, Space, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  publisherSyncJobApi,
  PublisherSyncJobRow,
} from '../../api/admin';
import { DataTable } from '../../components/common';
import { usePermission } from '../../hooks/usePermission';
import {
  canRetryPublisherSyncStatus,
  isRetiredPublisherSyncStatus,
  PUBLISHER_SYNC_RETIRED_STATUSES,
  RETIRED_PUBLISHER_SYNC_RETRY_MESSAGE,
} from './publisherSyncStatus';

const { Text } = Typography;

const statusColors: Record<string, string> = {
  PENDING: 'processing',
  PROCESSING: 'blue',
  SUCCEEDED: 'success',
  FAILED: 'error',
  LEGACY_PROVIDER_PUBLISH_RETIRED: 'warning',
  RUNTIME_INTENT_V1_RETIRED: 'warning',
  LEGACY_KEY_POOL_PUBLISH_RETIRED: 'warning',
  DEDICATED_KEY_META_V1_RETIRED: 'warning',
};

function formatTime(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function JsonBlock({ value }: { value: unknown }) {
  if (value == null) return <span>—</span>;
  return (
    <pre
      style={{
        margin: 0,
        padding: 12,
        borderRadius: 6,
        background: '#0f172a',
        color: '#e2e8f0',
        maxHeight: 360,
        overflow: 'auto',
        fontSize: 12,
      }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default function PublisherSyncJobsPage() {
  const { message, modal } = App.useApp();
  const canManage = usePermission('admin.page.publisher_sync_jobs.manage');
  const [form] = Form.useForm();
  const [items, setItems] = useState<PublisherSyncJobRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<PublisherSyncJobRow | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [scope, setScope] = useState<'all' | 'api_keys' | 'key_balances' | 'admin' | 'platform'>('all');

  const load = useCallback(async (nextPage: number) => {
    setLoading(true);
    try {
      const values = form.getFieldsValue();
      const data = await publisherSyncJobApi.list({
        page: nextPage,
        pageSize: 20,
        status: values.status || undefined,
        namespace: values.namespace || undefined,
        method: values.method || undefined,
        path: values.path?.trim() || undefined,
        resourceType: values.resourceType || undefined,
        resourceId: values.resourceId?.trim() || undefined,
        idempotencyKey: values.idempotencyKey?.trim() || undefined,
      });
      setItems(data.items);
      setTotal(data.total);
      setPage(nextPage);
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => {
    load(1);
  }, [load]);

  const retry = useCallback(async (row: PublisherSyncJobRow) => {
    if (isRetiredPublisherSyncStatus(row.status)) {
      message.warning(RETIRED_PUBLISHER_SYNC_RETRY_MESSAGE);
      return;
    }
    setRetrying(row.id);
    try {
      await publisherSyncJobApi.retry(row.id);
      message.success('重试完成');
      await load(page);
    } finally {
      setRetrying(null);
    }
  }, [load, message, page]);

  const replay = () => {
    modal.confirm({
      title: '确认重推 Publisher 状态',
      content: '重推会重新发送当前 admin 内的 API Key、余额、模型、渠道或平台配置，并为本次重推生成新的 replay 幂等键。',
      okText: '确认重推',
      cancelText: '取消',
      onOk: async () => {
        setReplaying(true);
        try {
          await publisherSyncJobApi.replay(scope);
          message.success('重推已触发');
          await load(1);
        } finally {
          setReplaying(false);
        }
      },
    });
  };

  const columns = useMemo<ColumnsType<PublisherSyncJobRow>>(() => [
    {
      title: '状态',
      dataIndex: 'status',
      width: 280,
      render: (value: string) => <Tag color={statusColors[value] || 'default'}>{value}</Tag>,
    },
    {
      title: '接口',
      key: 'request',
      width: 360,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <span><Tag>{row.namespace}</Tag><Text strong>{row.method}</Text></span>
          <Text code copyable ellipsis={{ tooltip: row.path }}>{row.path}</Text>
        </Space>
      ),
    },
    {
      title: '资源',
      key: 'resource',
      width: 220,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <span>{row.resourceType || '—'}</span>
          <Text type="secondary" copyable={!!row.resourceId}>{row.resourceId || '—'}</Text>
        </Space>
      ),
    },
    {
      title: '尝试',
      key: 'attempts',
      width: 110,
      render: (_, row) => `${row.attempts}/${row.maxAttempts}`,
    },
    {
      title: '下次重试',
      dataIndex: 'nextRunAt',
      width: 180,
      render: formatTime,
    },
    {
      title: '错误',
      dataIndex: 'lastError',
      ellipsis: true,
      width: 260,
      render: (value?: string | null) => value || '—',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 180,
      render: formatTime,
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 150,
      render: (_, row) => {
        const retired = isRetiredPublisherSyncStatus(row.status);
        return (
          <Space>
            <Button size="small" onClick={() => setActive(row)}>详情</Button>
            <Tooltip title={retired ? RETIRED_PUBLISHER_SYNC_RETRY_MESSAGE : undefined}>
              <span>
                <Button
                  size="small"
                  disabled={!canManage || !canRetryPublisherSyncStatus(row.status)}
                  loading={retrying === row.id}
                  onClick={() => retry(row)}
                >
                  重试
                </Button>
              </span>
            </Tooltip>
          </Space>
        );
      },
    },
  ], [canManage, retry, retrying]);

  return (
    <div>
      <h2 style={{ marginBottom: 8, fontSize: 20, fontWeight: 600 }}>Publisher 同步任务</h2>
      <div style={{ marginBottom: 16, color: 'var(--text-muted)', fontSize: 13 }}>
        查看 admin 发往 Publisher 的 API Key、余额、渠道和模型同步状态。失败任务会自动重试，也可以手动重试或全量重推。
      </div>

      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }} align="start">
        <Form
          form={form}
          layout="inline"
          style={{ rowGap: 8 }}
          onFinish={() => load(1)}
        >
          <Form.Item name="status">
            <Select
              allowClear
              placeholder="状态"
              style={{ width: 280 }}
              options={[
                { value: 'FAILED', label: 'FAILED' },
                { value: 'PENDING', label: 'PENDING' },
                { value: 'PROCESSING', label: 'PROCESSING' },
                { value: 'SUCCEEDED', label: 'SUCCEEDED' },
                ...PUBLISHER_SYNC_RETIRED_STATUSES.map((status) => ({
                  value: status,
                  label: status,
                })),
              ]}
            />
          </Form.Item>
          <Form.Item name="namespace">
            <Select
              allowClear
              placeholder="命名空间"
              style={{ width: 140 }}
              options={[
                { value: 'user', label: 'user' },
                { value: 'billing', label: 'billing' },
                { value: 'admin', label: 'admin' },
                { value: 'sre', label: 'sre' },
              ]}
            />
          </Form.Item>
          <Form.Item name="method">
            <Select
              allowClear
              placeholder="方法"
              style={{ width: 120 }}
              options={[
                { value: 'PUT', label: 'PUT' },
                { value: 'POST', label: 'POST' },
                { value: 'DELETE', label: 'DELETE' },
                { value: 'PATCH', label: 'PATCH' },
                { value: 'GET', label: 'GET' },
              ]}
            />
          </Form.Item>
          <Form.Item name="resourceType"><Input placeholder="资源类型" allowClear /></Form.Item>
          <Form.Item name="resourceId"><Input placeholder="资源 ID" allowClear /></Form.Item>
          <Form.Item name="path"><Input placeholder="接口路径" allowClear /></Form.Item>
          <Form.Item name="idempotencyKey"><Input placeholder="幂等键" allowClear /></Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">查询</Button>
              <Button onClick={() => { form.resetFields(); load(1); }}>重置</Button>
            </Space>
          </Form.Item>
        </Form>

        <Space>
          <Select
            value={scope}
            onChange={setScope}
            style={{ width: 150 }}
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'api_keys', label: 'API Key' },
              { value: 'key_balances', label: '余额' },
              { value: 'admin', label: '渠道/模型' },
              { value: 'platform', label: '平台配置' },
            ]}
          />
          <Button disabled={!canManage} loading={replaying} onClick={replay}>
            全量重推
          </Button>
        </Space>
      </Space>

      <DataTable<PublisherSyncJobRow>
        columns={columns}
        dataSource={items}
        rowKey="id"
        loading={loading}
        scroll={{ x: 1580 }}
        listPagination={{
          current: page,
          pageSize: 20,
          total,
          onChange: (next) => load(next),
        }}
      />

      <Drawer
        title="Publisher 同步任务详情"
        width={760}
        open={!!active}
        onClose={() => setActive(null)}
      >
        {active && (
          <Space direction="vertical" size={18} style={{ width: '100%' }}>
            <div>
              <Text type="secondary">幂等键</Text>
              <div><Text code copyable>{active.idempotencyKey}</Text></div>
            </div>
            <div>
              <Text type="secondary">请求</Text>
              <div>
                <Tag>{active.namespace}</Tag>
                <Text strong>{active.method}</Text>
                <Text code copyable style={{ marginLeft: 8 }}>{active.path}</Text>
              </div>
            </div>
            <div>
              <Text type="secondary">状态</Text>
              <div><Tag color={statusColors[active.status] || 'default'}>{active.status}</Tag></div>
            </div>
            <div>
              <Text type="secondary">失败原因</Text>
              <div>{active.lastError || '—'}</div>
            </div>
            <div>
              <Text type="secondary">请求体</Text>
              <JsonBlock value={active.body} />
            </div>
            <div>
              <Text type="secondary">Publisher 响应</Text>
              <JsonBlock value={active.response} />
            </div>
          </Space>
        )}
      </Drawer>
    </div>
  );
}
