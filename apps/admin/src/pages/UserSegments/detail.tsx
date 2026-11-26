import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Spin,
  message,
} from 'antd';
import {
  PageHeader,
  EmptyPlaceholder,
  DataTable,
} from '../../components/common';
import {
  userSegmentApi,
  type UserSegment,
  type UserSegmentMember,
  type UserSegmentReferences,
} from '../../api/v2';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { usePermission } from '../../hooks/usePermission';

const TABS = [
  { key: 'basic', label: '基本信息' },
  { key: 'rules', label: '规则配置' },
  { key: 'members', label: '当前成员' },
  { key: 'refs', label: '被引用' },
];

const MEMBERS_PAGE_SIZE = 20;

function BasicForm({
  segment,
  onSave,
  canManage,
}: {
  segment: UserSegment;
  onSave: (next: Partial<UserSegment>) => Promise<void>;
  canManage: boolean;
}) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    form.setFieldsValue({
      name: segment.name,
      description: segment.description,
      ruleType: segment.ruleType,
    });
  }, [segment, form]);

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await onSave({
        name: values.name,
        description: values.description,
      });
      message.success('已保存');
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Form form={form} layout="vertical" style={{ maxWidth: 560 }}>
      <Form.Item name="name" label="分群名" rules={[{ required: true }]}>
        <Input disabled={!canManage} />
      </Form.Item>
      <Form.Item name="description" label="描述">
        <Input.TextArea rows={3} disabled={!canManage} />
      </Form.Item>
      <Form.Item name="ruleType" label="规则类型">
        <Select
          disabled
          options={[
            { value: 'STATIC', label: '静态' },
            { value: 'DYNAMIC', label: '动态' },
          ]}
        />
      </Form.Item>
      {canManage && (
        <Button type="primary" loading={saving} onClick={submit}>
          保存
        </Button>
      )}
    </Form>
  );
}

function RuleEditor({
  segment,
  onSaved,
  canManage,
}: {
  segment: UserSegment;
  onSaved: () => void;
  canManage: boolean;
}) {
  const [ruleExpr, setRuleExpr] = useState(segment.ruleExpr ?? '');
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewResult, setPreviewResult] = useState<{
    matchedCount: number;
    sampleUserIds: string[];
    capped: boolean;
    message?: string;
  } | null>(null);

  useEffect(() => {
    setRuleExpr(segment.ruleExpr ?? '');
    setPreviewResult(null);
  }, [segment]);

  if (segment.ruleType === 'STATIC') {
    return (
      <EmptyPlaceholder
        title="静态分群"
        description="静态分群通过 “当前成员” Tab 直接管理用户列表。"
      />
    );
  }

  const handlePreview = async () => {
    if (!ruleExpr.trim()) {
      message.warning('请先填写规则表达式');
      return;
    }
    try {
      JSON.parse(ruleExpr);
    } catch {
      message.error('规则表达式不是合法 JSON');
      return;
    }
    setPreviewing(true);
    try {
      const res = await userSegmentApi.preview(ruleExpr);
      setPreviewResult(res);
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? '预览失败';
      message.error(msg);
    } finally {
      setPreviewing(false);
    }
  };

  const handleSave = async () => {
    if (!ruleExpr.trim()) {
      message.warning('规则表达式不能为空');
      return;
    }
    try {
      JSON.parse(ruleExpr);
    } catch {
      message.error('规则表达式不是合法 JSON');
      return;
    }
    setSaving(true);
    try {
      await userSegmentApi.update(segment.id, { ruleExpr });
      message.success('规则已保存');
      onSaved();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? '保存失败';
      message.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 8, color: 'var(--text-muted)', fontSize: 12 }}>
        规则表达式 (JSON)：保存前可以先预览匹配人数。
      </div>
      <Input.TextArea
        rows={10}
        value={ruleExpr}
        onChange={(e) => setRuleExpr(e.target.value)}
        readOnly={!canManage}
        placeholder='{"and": [{"field": "monthlySpentCents", "op": ">", "value": 10000}]}'
        style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}
      />
      {canManage && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <Button onClick={handlePreview} loading={previewing}>
            预览匹配人数
          </Button>
          <Button type="primary" onClick={handleSave} loading={saving}>
            保存规则
          </Button>
        </div>
      )}
      {previewResult && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            background: previewResult.capped
              ? 'var(--bg-warning, #fff7e6)'
              : 'var(--bg-muted, #fafafa)',
            border: `1px solid ${
              previewResult.capped
                ? 'var(--border-warning, #ffd591)'
                : 'var(--border, #eee)'
            }`,
            borderRadius: 4,
            fontSize: 13,
          }}
        >
          {previewResult.capped ? (
            <>
              <div
                style={{
                  fontWeight: 500,
                  marginBottom: 6,
                  color: 'var(--color-warning, #d46b08)',
                }}
              >
                结果太大,请优化规则
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                {previewResult.message ??
                  '匹配用户超过上限，请添加更多筛选条件后重试。'}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 500, marginBottom: 6 }}>
                匹配用户数：
                {previewResult.matchedCount.toLocaleString('zh-CN')}
              </div>
              {previewResult.sampleUserIds.length > 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  示例 userId：
                  {previewResult.sampleUserIds.slice(0, 5).join('、')}
                  {previewResult.sampleUserIds.length > 5 ? ' …' : ''}
                </div>
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  暂无匹配用户
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MembersTab({ segment, canManage }: { segment: UserSegment; canManage: boolean }) {
  const [addOpen, setAddOpen] = useState(false);
  const [addInput, setAddInput] = useState('');
  const [adding, setAdding] = useState(false);

  const members = usePaginatedList<UserSegmentMember>({
    pageSize: MEMBERS_PAGE_SIZE,
    deps: [segment.id],
    onError: () => message.error('加载成员失败'),
    fetcher: useCallback(async ({ page, pageSize }) => {
      const res = await userSegmentApi.listMembers(segment.id, {
        page,
        pageSize,
      });
      return {
        items: res.items,
        total: res.total,
        page,
        pageSize,
      };
    }, [segment.id]),
  });

  const handleRemove = async (userId: string) => {
    try {
      await userSegmentApi.removeMember(segment.id, userId);
      message.success('已移除');
      members.reload();
    } catch {
      message.error('移除失败');
    }
  };

  const handleAdd = async () => {
    const ids = addInput
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      message.warning('请输入至少一个 userId');
      return;
    }
    setAdding(true);
    try {
      const res = await userSegmentApi.addMembers(segment.id, ids);
      message.success(
        `添加完成：新增 ${res.added}，已存在 ${res.skipped}，无效 ${res.missing.length}`,
      );
      setAddOpen(false);
      setAddInput('');
      if (members.page === 1) {
        members.reload();
      } else {
        members.setPage(1);
      }
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? '添加失败';
      message.error(msg);
    } finally {
      setAdding(false);
    }
  };

  const isStatic = segment.ruleType === 'STATIC';

  const columns = [
    {
      title: '用户',
      key: 'user',
      render: (_: unknown, r: UserSegmentMember) => (
        <div>
          <div>{r.user?.email ?? r.userId}</div>
          {r.user?.nickname && (
            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
              {r.user.nickname}
            </div>
          )}
        </div>
      ),
    },
    {
      title: '加入时间',
      dataIndex: 'joinedAt',
      key: 'joinedAt',
      width: 200,
      render: (v: string | null) => v ?? '-',
    },
    ...(isStatic && canManage
      ? [
          {
            title: '操作',
            key: 'action',
            width: 100,
            align: 'right' as const,
            render: (_: unknown, r: UserSegmentMember) => (
              <Popconfirm
                title="确认移除该成员？"
                onConfirm={() => handleRemove(r.userId)}
              >
                <Button size="small" type="link" danger>
                  移除
                </Button>
              </Popconfirm>
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <div
        style={{
          marginBottom: 12,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          {isStatic
            ? '静态分群成员可手动添加 / 移除。'
            : '动态分群成员由规则实时匹配，不可手动维护。'}
        </div>
        {isStatic && canManage && (
          <Button type="primary" onClick={() => setAddOpen(true)}>
            + 添加成员
          </Button>
        )}
      </div>
      <DataTable<UserSegmentMember>
        columns={columns}
        dataSource={members.items}
        rowKey="userId"
        loading={members.loading}
        listPagination={members.tablePagination}
      />
      <Modal
        title="添加成员"
        open={addOpen}
        onOk={handleAdd}
        confirmLoading={adding}
        onCancel={() => {
          setAddOpen(false);
          setAddInput('');
        }}
        width={520}
      >
        <div
          style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}
        >
          每行一个 userId，或用逗号 / 空格分隔；单次最多 5000 个。
        </div>
        <Input.TextArea
          rows={8}
          value={addInput}
          onChange={(e) => setAddInput(e.target.value)}
          placeholder={'usr_xxx\nusr_yyy\nusr_zzz'}
        />
      </Modal>
    </div>
  );
}

function ReferencesTab({ segment }: { segment: UserSegment }) {
  const [data, setData] = useState<UserSegmentReferences | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchRefs = async () => {
      setLoading(true);
      try {
        const res = await userSegmentApi.references(segment.id);
        if (!cancelled) setData(res);
      } catch {
        if (!cancelled) message.error('加载引用关系失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchRefs();
    return () => {
      cancelled = true;
    };
  }, [segment.id]);

  if (loading) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <Spin />
      </div>
    );
  }

  if (!data) return null;

  const totalRefs =
    data.grantRules.length +
    data.creditPolicies.length +
    data.campaigns.length +
    data.discountCodes.length;

  if (totalRefs === 0) {
    return (
      <EmptyPlaceholder
        title="暂无引用"
        description="此分群暂未被任何规则 / 活动 / 促销码引用。"
      />
    );
  }

  const Section = ({
    title,
    items,
  }: {
    title: string;
    items: Array<{ id: string; label: string }>;
  }) => {
    if (items.length === 0) return null;
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 500, marginBottom: 8 }}>
          {title}（{items.length}）
        </div>
        <ul
          style={{
            margin: 0,
            paddingLeft: 20,
            color: 'var(--text-muted)',
            fontSize: 13,
          }}
        >
          {items.map((it) => (
            <li key={it.id}>
              {it.label}
              <span
                style={{
                  marginLeft: 8,
                  color: 'var(--text-muted)',
                  fontSize: 11,
                }}
              >
                {it.id}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div>
      <Section
        title="信用发放规则"
        items={data.grantRules.map((r) => ({ id: r.id, label: r.name }))}
      />
      <Section
        title="信用策略"
        items={data.creditPolicies.map((r) => ({ id: r.id, label: r.name }))}
      />
      <Section
        title="运营活动"
        items={data.campaigns.map((c) => ({ id: c.id, label: c.name }))}
      />
      <Section
        title="促销码"
        items={data.discountCodes.map((d) => ({ id: d.id, label: d.code }))}
      />
    </div>
  );
}

export default function UserSegmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [segment, setSegment] = useState<UserSegment | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('basic');
  const [actioning, setActioning] = useState(false);
  const canManage = usePermission('admin.page.user_segments.manage');

  const fetchOne = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await userSegmentApi.get(id);
      setSegment(res);
    } catch {
      message.error('加载分群详情失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOne();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleSave = async (next: Partial<UserSegment>) => {
    if (!id) return;
    await userSegmentApi.update(id, next);
    fetchOne();
  };

  const handleRefresh = async () => {
    if (!id) return;
    setActioning(true);
    try {
      await userSegmentApi.refresh(id);
      message.success('成员数已刷新');
      fetchOne();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? '刷新失败';
      message.error(msg);
    } finally {
      setActioning(false);
    }
  };

  const handleToggleActive = async () => {
    if (!id || !segment) return;
    setActioning(true);
    try {
      await userSegmentApi.update(id, { isActive: !segment.isActive });
      message.success(segment.isActive ? '已停用' : '已启用');
      fetchOne();
    } catch {
      message.error('更新状态失败');
    } finally {
      setActioning(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    setActioning(true);
    try {
      await userSegmentApi.delete(id);
      message.success('已删除');
      navigate('/user-segments');
    } catch {
      message.error('删除失败');
      setActioning(false);
    }
  };

  const renderTab = () => {
    if (!segment) return null;
    if (tab === 'basic') return <BasicForm segment={segment} onSave={handleSave} canManage={canManage} />;
    if (tab === 'rules')
      return <RuleEditor segment={segment} onSaved={fetchOne} canManage={canManage} />;
    if (tab === 'members') return <MembersTab segment={segment} canManage={canManage} />;
    if (tab === 'refs') return <ReferencesTab segment={segment} />;
    return null;
  };

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin />
      </div>
    );
  }

  if (!segment) return null;

  return (
    <div>
      <PageHeader
        title={segment.name}
        subtitle={segment.description}
        breadcrumb={[
          { label: '用户分群', to: '/user-segments' },
          segment.name,
        ]}
        actions={[
          ...(canManage
            ? [
                <Button key="refresh" loading={actioning} onClick={handleRefresh}>
                  刷新成员数
                </Button>,
                <Button key="toggle" loading={actioning} onClick={handleToggleActive}>
                  {segment.isActive ? '停用分群' : '启用分群'}
                </Button>,
                <Popconfirm key="delete" title="确认删除该分群？" onConfirm={handleDelete}>
                  <Button danger loading={actioning}>
                    删除分群
                  </Button>
                </Popconfirm>,
              ]
            : []),
          <Button key="back" onClick={() => navigate('/user-segments')}>
            返回列表
          </Button>,
        ]}
      />
      <div className="rt-drawer-tabs" style={{ marginBottom: 16 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`rt-drawer-tab ${
              tab === t.key ? 'rt-drawer-tab-active' : ''
            }`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div>{renderTab()}</div>
    </div>
  );
}
