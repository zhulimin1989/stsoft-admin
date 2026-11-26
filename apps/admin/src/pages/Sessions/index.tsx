import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card,
  Tag,
  Button,
  Space,
  Typography,
  Statistic,
  Row,
  Col,
  message,
} from 'antd';
import {
  MessageOutlined,
  ReloadOutlined,
  ClockCircleOutlined,
  UserOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { sessionApi } from '../../api/admin';
import { DataTable } from '../../components/common';
import { usePaginatedList } from '../../hooks/usePaginatedList';

interface SessionStats {
  totalConversations: number;
  todayNew: number;
  activeLastHour: number;
}

interface Session {
  id: string;
  userId: string;
  title: string;
  status: string;
  updatedAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: 'green',
  idle: 'blue',
  closed: 'default',
  error: 'red',
};

const STATUS_LABELS: Record<string, string> = {
  active: '活跃',
  idle: '空闲',
  closed: '已关闭',
  error: '异常',
};

export default function SessionsPage() {
  const [stats, setStats] = useState<SessionStats>({ totalConversations: 0, todayNew: 0, activeLastHour: 0 });
  const [search, setSearch] = useState('');
  const [searchRows, setSearchRows] = useState<Session[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchRequestRef = useRef(0);

  const fetchStats = useCallback(async () => {
    try {
      const res = await sessionApi.stats();
      if (res) setStats(res);
    } catch {
      // silent
    }
  }, []);

  const fetchSessions = useCallback(async ({ page, pageSize }: { page: number; pageSize: number }) => {
    const res = await sessionApi.list({ page, pageSize });
    return {
      items: res.items || [],
      total: res.total || 0,
      page,
      pageSize,
    };
  }, []);

  const sessionList = usePaginatedList<Session>({
    fetcher: fetchSessions,
    onError: () => {
      message.error('加载会话列表失败');
    },
    clearOnError: true,
  });
  const isSearchMode = search.trim().length > 0;

  useEffect(() => {
    const query = search.trim();
    if (!query) {
      setSearchRows([]);
      setSearchLoading(false);
      return undefined;
    }
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      sessionApi
        .listAll<Session>()
        .then((rows) => {
          if (requestId === searchRequestRef.current) setSearchRows(rows);
        })
        .catch(() => {
          if (requestId === searchRequestRef.current) setSearchRows([]);
        })
        .finally(() => {
          if (requestId === searchRequestRef.current) setSearchLoading(false);
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  const reloadSessions = sessionList.reload;

  const fetchAll = useCallback(() => {
    void fetchStats();
    reloadSessions();
  }, [fetchStats, reloadSessions]);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    const timer = setInterval(fetchAll, 30000);
    return () => clearInterval(timer);
  }, [fetchAll]);

  const columns = [
    { title: '会话 ID', dataIndex: 'id', key: 'id', width: 220, ellipsis: true },
    { title: '用户 ID', dataIndex: 'userId', key: 'userId', width: 220, ellipsis: true },
    { title: '标题', dataIndex: 'title', key: 'title', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => (
        <Tag color={STATUS_COLORS[status] || 'default'}>
          {STATUS_LABELS[status] || status}
        </Tag>
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 180,
      render: (val: string) => val ? dayjs(val).format('YYYY-MM-DD HH:mm:ss') : '-',
    },
  ];

  return (
    <div>
      <h2 style={{ marginBottom: 24, fontSize: 20, fontWeight: 600 }}>
        <MessageOutlined /> 会话监控
      </h2>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={8}>
          <Card bordered={false}>
            <Statistic title="会话总数" value={stats.totalConversations} prefix={<MessageOutlined />} />
          </Card>
        </Col>
        <Col span={8}>
          <Card bordered={false}>
            <Statistic
              title="今日新增"
              value={stats.todayNew}
              prefix={<UserOutlined />}
              valueStyle={{ color: '#1a1a1a' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card bordered={false}>
            <Statistic
              title="最近 1 小时活跃"
              value={stats.activeLastHour}
              prefix={<ThunderboltOutlined />}
              valueStyle={{ color: '#10b981' }}
            />
          </Card>
        </Col>
      </Row>

      <Card bordered={false}>
        <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
          <Typography.Text type="secondary">
            <ClockCircleOutlined /> 每 30 秒自动刷新
          </Typography.Text>
          <Button icon={<ReloadOutlined />} onClick={fetchAll}>
            刷新
          </Button>
        </Space>

        <DataTable<Session>
          dataSource={isSearchMode ? searchRows : sessionList.items}
          columns={columns}
          rowKey="id"
          loading={isSearchMode ? searchLoading : sessionList.loading}
          scroll={{ x: 960 }}
          searchable
          searchPlaceholder="搜索会话 ID / 用户 ID / 标题"
          onSearchChange={setSearch}
          pagination={isSearchMode ? { pageSize: 20 } : undefined}
          listPagination={isSearchMode ? undefined : sessionList.tablePagination}
        />
      </Card>
    </div>
  );
}
