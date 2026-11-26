import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Input,
  Select,
  Switch,
  Spin,
  message,
  Space,
  Modal,
} from 'antd';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
  PageHeader,
  StatCard,
  StatCardGroup,
  Tag,
  EmptyPlaceholder,
  type TagVariant,
} from '../../components/common';
import { ticketApi, type Ticket, type TicketMessage } from '../../api/v2';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { usePermission } from '../../hooks/usePermission';
import { formatCurrencyCents } from '../../utils/price';

dayjs.extend(relativeTime);

const STATUS_VARIANT: Record<Ticket['status'], TagVariant> = {
  OPEN: 'warn',
  IN_PROGRESS: 'proc',
  RESOLVED: 'success',
  CLOSED: 'muted',
};
const STATUS_LABEL: Record<Ticket['status'], string> = {
  OPEN: '未处理',
  IN_PROGRESS: '处理中',
  RESOLVED: '已解决',
  CLOSED: '已关闭',
};

const PRIORITY_OPTIONS = [
  { value: 'URGENT', label: '紧急' },
  { value: 'HIGH', label: '高' },
  { value: 'NORMAL', label: '普通' },
  { value: 'LOW', label: '低' },
];

const CATEGORY_OPTIONS = [
  { value: 'BILLING', label: '计费' },
  { value: 'TECHNICAL', label: '技术' },
  { value: 'REFUND', label: '退款' },
  { value: 'FEATURE', label: '功能' },
  { value: 'OTHER', label: '其他' },
];

const STATUS_SELECT_OPTIONS = [
  { value: 'OPEN', label: '未处理' },
  { value: 'IN_PROGRESS', label: '处理中' },
  { value: 'RESOLVED', label: '已解决' },
  { value: 'CLOSED', label: '已关闭' },
];

interface UserContext {
  id?: string;
  email?: string | null;
  nickname?: string;
  userId?: string;
  plan?: string;
  totalSpent?: number;
  recentOrders?: Array<{ id: string; amount: number; createdAt: string }>;
}

interface TicketDetailResp {
  ticket: Ticket;
  messages: TicketMessage[];
  user?: UserContext | null;
}

function MessageBubble({ msg }: { msg: TicketMessage }) {
  const isUser = msg.authorType === 'USER';
  const isSystem = msg.authorType === 'SYSTEM';
  const align: React.CSSProperties = {
    display: 'flex',
    flexDirection: isUser ? 'row' : 'row-reverse',
    marginBottom: 12,
  };
  const bubble: React.CSSProperties = {
    maxWidth: '75%',
    padding: '8px 12px',
    borderRadius: 8,
    background: isSystem
      ? 'var(--bg-muted, #f4f4f5)'
      : isUser
        ? 'var(--bg-elev, #f7f8fa)'
        : 'var(--brand-50, #e8f1ff)',
    fontSize: 13,
    lineHeight: 1.6,
  };
  return (
    <div style={align}>
      <div style={bubble}>
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            marginBottom: 4,
          }}
        >
          {msg.authorType === 'USER'
            ? '用户'
            : msg.authorType === 'ADMIN'
              ? '客服'
              : '系统'}
          {msg.isInternal && (
            <span style={{ marginLeft: 8, color: 'var(--warn, #d97706)' }}>
              内部备注
            </span>
          )}
          <span style={{ marginLeft: 8 }}>
            {dayjs(msg.createdAt).fromNow()}
          </span>
        </div>
        <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
        {msg.attachments?.length > 0 && (
          <div style={{ marginTop: 6, fontSize: 12 }}>
            {msg.attachments.map((a, i) => (
              <a
                key={i}
                href={a}
                target="_blank"
                rel="noreferrer"
                style={{ marginRight: 8 }}
              >
                附件 {i + 1}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ReplyBox({
  ticketId,
  onSent,
  canReply,
}: {
  ticketId: string;
  onSent: () => void;
  canReply: boolean;
}) {
  const [content, setContent] = useState('');
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (!content.trim()) return;
    setSending(true);
    try {
      await ticketApi.reply(ticketId, content, internal);
      setContent('');
      onSent();
    } catch {
      message.error('回复失败');
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      style={{
        borderTop: '1px solid var(--border, #e5e7eb)',
        paddingTop: 12,
        marginTop: 12,
      }}
    >
      {canReply ? (
        <Input.TextArea
          rows={4}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="输入回复…（支持换行）"
        />
      ) : (
        <EmptyPlaceholder title="只读工单" description="当前账号没有工单处理权限。" />
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          marginTop: 8,
          gap: 12,
        }}
      >
        {canReply && (
          <>
            <Space>
              <span style={{ fontSize: 12 }}>内部备注</span>
              <Switch checked={internal} onChange={setInternal} size="small" />
            </Space>
            <div style={{ flex: 1 }} />
            <Button type="primary" onClick={submit} loading={sending}>
              提交
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function UserSidebar({ user }: { user?: UserContext | null }) {
  const platformCurrency = usePlatformCurrency();
  const formatMajorAmount = (amount: number) =>
    formatCurrencyCents(Math.round(amount * 100), platformCurrency);

  if (!user) {
    return (
      <EmptyPlaceholder
        title="用户上下文"
        description="用户基本信息 / 订阅 / 累计消费 / 最近订单待接口接入。"
        todos={['GET /admin/v2/tickets/:id 返回 user 字段']}
      />
    );
  }
  return (
    <div>
      <StatCardGroup columns={1}>
        <StatCard label="邮箱" value={user.email ?? '—'} />
        <StatCard label="当前订阅" value={user.plan ?? '—'} />
        <StatCard
          label="累计消费"
          value={
            typeof user.totalSpent === 'number'
              ? formatMajorAmount(user.totalSpent)
              : '—'
          }
        />
      </StatCardGroup>
      <div style={{ marginTop: 12 }}>
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            marginBottom: 6,
          }}
        >
          最近 5 单
        </div>
        {!user.recentOrders || user.recentOrders.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            暂无订单
          </div>
        ) : (
          user.recentOrders.slice(0, 5).map((o) => (
            <div
              key={o.id}
              style={{
                fontSize: 12,
                padding: '6px 0',
                borderBottom: '1px solid var(--border, #f0f0f0)',
              }}
            >
              <span
                style={{ fontFamily: 'var(--font-mono, monospace)' }}
              >
                {o.id}
              </span>
              <span style={{ float: 'right' }}>{formatMajorAmount(o.amount)}</span>
              <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                {dayjs(o.createdAt).fromNow()}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<TicketDetailResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assigneeId, setAssigneeId] = useState('');
  const [mergeOpen, setMergeOpen] = useState(false);
  const [targetTicketId, setTargetTicketId] = useState('');
  const [actioning, setActioning] = useState(false);
  const canManage = usePermission('admin.page.tickets.manage');

  const fetchDetail = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = (await ticketApi.get(id)) as TicketDetailResp;
      setData(res);
    } catch {
      message.error('加载工单失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleStatus = async (status: string) => {
    if (!id) return;
    try {
      await ticketApi.updateStatus(id, status);
      message.success('状态已更新');
      fetchDetail();
    } catch {
      message.error('更新状态失败');
    }
  };

  const handleCategory = async (category: Ticket['category']) => {
    if (!id) return;
    try {
      await ticketApi.updateCategory(id, category);
      fetchDetail();
    } catch {
      message.error('更新分类失败');
    }
  };

  const handlePriority = async (priority: Ticket['priority']) => {
    if (!id) return;
    try {
      await ticketApi.updatePriority(id, priority);
      fetchDetail();
    } catch {
      message.error('更新优先级失败');
    }
  };

  const handleClose = async () => {
    if (!id) return;
    try {
      await ticketApi.close(id);
      message.success('工单已关闭');
      fetchDetail();
    } catch {
      message.error('关闭失败');
    }
  };

  const handleAssign = async () => {
    if (!id) return;
    setActioning(true);
    try {
      await ticketApi.assign(id, assigneeId.trim() || null);
      message.success(assigneeId.trim() ? '已分配' : '已取消分配');
      setAssignOpen(false);
      fetchDetail();
    } catch {
      message.error('分配失败');
    } finally {
      setActioning(false);
    }
  };

  const handleMerge = async () => {
    if (!id || !targetTicketId.trim()) {
      message.error('请输入目标工单 ID');
      return;
    }
    setActioning(true);
    try {
      await ticketApi.merge(id, targetTicketId.trim());
      message.success('工单已合并');
      setMergeOpen(false);
      fetchDetail();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? '合并失败';
      message.error(msg);
    } finally {
      setActioning(false);
    }
  };

  const ticket = data?.ticket;
  const messages = useMemo(() => data?.messages ?? [], [data]);

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin />
      </div>
    );
  }

  if (!ticket) return null;

  return (
    <div>
      <PageHeader
        title={ticket.subject}
        subtitle={ticket.ticketNumber}
        breadcrumb={[
          { label: '工单中心', to: '/tickets' },
          ticket.ticketNumber,
        ]}
        actions={[
          <Tag key="status" variant={STATUS_VARIANT[ticket.status]}>
            {STATUS_LABEL[ticket.status]}
          </Tag>,
          ...(canManage
            ? [
                <Select
                  key="cat"
                  size="small"
                  value={ticket.category}
                  style={{ width: 110 }}
                  options={CATEGORY_OPTIONS}
                  onChange={handleCategory}
                />,
                <Select
                  key="pri"
                  size="small"
                  value={ticket.priority}
                  style={{ width: 110 }}
                  options={PRIORITY_OPTIONS}
                  onChange={handlePriority}
                />,
                <Select
                  key="st"
                  size="small"
                  value={ticket.status}
                  style={{ width: 110 }}
                  options={STATUS_SELECT_OPTIONS}
                  onChange={handleStatus}
                />,
                <Button
                  key="assign"
                  size="small"
                  onClick={() => {
                    setAssigneeId(ticket.assigneeId ?? '');
                    setAssignOpen(true);
                  }}
                >
                  分配
                </Button>,
                <Button
                  key="merge"
                  size="small"
                  onClick={() => {
                    setTargetTicketId('');
                    setMergeOpen(true);
                  }}
                >
                  合并
                </Button>,
                <Button key="close" size="small" onClick={handleClose}>
                  关闭工单
                </Button>,
              ]
            : []),
          <Button key="back" size="small" onClick={() => navigate('/tickets')}>
            返回
          </Button>,
        ]}
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '3fr 2fr',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <div
          style={{
            background: 'var(--bg-card, #fff)',
            border: '1px solid var(--border, #e5e7eb)',
            borderRadius: 8,
            padding: 16,
          }}
        >
          {messages.length === 0 ? (
            <div
              style={{
                color: 'var(--text-muted)',
                textAlign: 'center',
                padding: 32,
              }}
            >
              暂无对话
            </div>
          ) : (
            messages.map((m) => <MessageBubble key={m.id} msg={m} />)
          )}
          <ReplyBox ticketId={ticket.id} onSent={fetchDetail} canReply={canManage} />
        </div>

        <div
          style={{
            background: 'var(--bg-card, #fff)',
            border: '1px solid var(--border, #e5e7eb)',
            borderRadius: 8,
            padding: 16,
          }}
        >
          <UserSidebar user={data?.user} />
        </div>
      </div>

      <Modal
        title="分配工单"
        open={assignOpen}
        onOk={handleAssign}
        confirmLoading={actioning}
        onCancel={() => setAssignOpen(false)}
        okText="保存"
      >
        <Input
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          placeholder="输入处理人管理员 ID；留空表示取消分配"
        />
      </Modal>

      <Modal
        title="合并工单"
        open={mergeOpen}
        onOk={handleMerge}
        confirmLoading={actioning}
        onCancel={() => setMergeOpen(false)}
        okText="确认合并"
      >
        <Input
          value={targetTicketId}
          onChange={(e) => setTargetTicketId(e.target.value)}
          placeholder="输入目标工单 ID"
        />
      </Modal>
    </div>
  );
}
