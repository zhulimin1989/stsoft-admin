import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Select, Space, Switch, message } from 'antd';
import { PlusOutlined, ExperimentOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  PageHeader,
  StatCard,
  StatCardGroup,
  FilterBar,
  DataTable,
  Tag,
  EmptyPlaceholder,
} from '../../components/common';
import {
  grantRuleApi,
  userSegmentApi,
  type CreditGrantRule,
  type UserSegment,
} from '../../api/v2';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { usePermission } from '../../hooks/usePermission';
import { warnNonCritical } from '../../utils/logging';

const TRIGGER_LABEL: Record<CreditGrantRule['triggerType'], string> = {
  DAILY_CRON: '每日定时',
  FIRST_LOGIN: '首次登录',
  DAILY_CHECKIN: '每日签到',
  TASK_COMPLETE: '任务完成',
  WEEKLY_CRON: '每周定时',
};

const REWARD_TYPE_LABEL: Record<CreditGrantRule['rewardType'], string> = {
  CREDIT: '积分',
  BALANCE: '余额',
  BOOSTER_PACK: '加油包',
};

const EXPIRE_LABEL: Record<CreditGrantRule['expirePolicy'], string> = {
  PERMANENT: '永久',
  SAME_DAY_END: '当天过期',
  N_DAYS: 'N 天后过期',
  NEXT_RESET: '下次重置前',
};

export default function GrantRulesPage() {
  const canManage = usePermission('admin.page.grant_rules.manage');
  const navigate = useNavigate();
  const [segments, setSegments] = useState<UserSegment[]>([]);
  const [search, setSearch] = useState('');
  const [triggerFilter, setTriggerFilter] = useState<string | undefined>();
  const [segmentFilter, setSegmentFilter] = useState<string | undefined>();
  const [activeFilter, setActiveFilter] = useState<boolean | undefined>();

  const grantRules = usePaginatedList<CreditGrantRule>({
    pageSize: 20,
    deps: [search, triggerFilter, segmentFilter, activeFilter],
    onError: () => message.error('加载定时奖励失败'),
    fetcher: useCallback(async ({ page, pageSize }) => {
      const res = await grantRuleApi.list({
        page,
        pageSize,
        search: search || undefined,
        triggerType: triggerFilter,
        isActive: activeFilter,
        segmentId: segmentFilter,
      });
      return {
        items: res.items || [],
        total: res.total || 0,
        page,
        pageSize,
      };
    }, [activeFilter, search, segmentFilter, triggerFilter]),
  });

  useEffect(() => {
    userSegmentApi
      .list({ pageSize: 100 })
      .then((res) => setSegments(res.items || []))
      .catch((error: unknown) => {
        warnNonCritical('GrantRules segment preload', error);
      });
  }, []);

  const filteredItems = grantRules.items;

  const stats = useMemo(() => {
    return {
      total: grantRules.total,
      todayGranted: '—',
      total30d: '—',
      benefitedUsers: '—',
    };
  }, [grantRules.total]);

  const segmentLabel = (id?: string) =>
    segments.find((s) => s.id === id)?.name ?? id ?? '所有用户';

  const handleToggle = async (row: CreditGrantRule, val: boolean) => {
    try {
      await grantRuleApi.update(row.id, { isActive: val });
      message.success(val ? '已启用' : '已停用');
      grantRules.reload();
    } catch {
      message.error('操作失败');
    }
  };

  const handleCopy = async (row: CreditGrantRule) => {
    try {
      const { id: _omit, ...rest } = row;
      void _omit;
      await grantRuleApi.create({ ...rest, name: `${row.name} (副本)`, isActive: false });
      message.success('已复制');
      grantRules.reload();
    } catch {
      message.error('复制失败');
    }
  };

  const handleManualTrigger = async (row: CreditGrantRule) => {
    try {
      await grantRuleApi.manualTrigger(row.id);
      message.success('已触发');
    } catch {
      message.error('触发失败');
    }
  };

  const columns = [
    {
      title: '规则名',
      dataIndex: 'name',
      key: 'name',
      render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span>,
    },
    {
      title: '触发方式',
      key: 'trigger',
      width: 180,
      render: (_: unknown, r: CreditGrantRule) => (
        <Space size={4} direction="vertical">
          <Tag>{TRIGGER_LABEL[r.triggerType] ?? r.triggerType}</Tag>
          {r.triggerType === 'DAILY_CRON' && r.cronExpr && (
            <span style={{ fontSize: 11, fontFamily: 'monospace' }}>
              {r.cronExpr}
            </span>
          )}
        </Space>
      ),
    },
    {
      title: '奖励内容',
      key: 'reward',
      render: (_: unknown, r: CreditGrantRule) => {
        const policy = EXPIRE_LABEL[r.expirePolicy] ?? r.expirePolicy;
        const expire =
          r.expirePolicy === 'N_DAYS' && r.expireDays
            ? `${r.expireDays} 天后过期`
            : policy;
        return (
          <span>
            {r.rewardAmount} {REWARD_TYPE_LABEL[r.rewardType] ?? r.rewardType}，{expire}
          </span>
        );
      },
    },
    {
      title: '适用分群',
      key: 'segment',
      width: 140,
      render: (_: unknown, r: CreditGrantRule) => segmentLabel(r.segmentId),
    },
    {
      title: '启停',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 80,
      render: (v: boolean, r: CreditGrantRule) => (
        <Switch checked={v} size="small" disabled={!canManage} onChange={(b) => handleToggle(r, b)} />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 280,
      align: 'right' as const,
      render: (_: unknown, r: CreditGrantRule) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            onClick={() => navigate(`/grant-rules/${r.id}`)}
          >
            详情
          </Button>
          <Button type="link" size="small" disabled={!canManage} onClick={() => handleCopy(r)}>
            复制
          </Button>
          <Button type="link" size="small" disabled={!canManage} onClick={() => handleManualTrigger(r)}>
            手动触发
          </Button>
          <Button
            type="link"
            size="small"
            onClick={() => navigate(`/grant-rules/${r.id}?tab=redemptions`)}
          >
            查看记录
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="定时奖励"
        subtitle="用于“每日免费 N 积分当天过期”等运营策略"
        actions={[
          <Button
            key="new"
            type="primary"
            icon={<PlusOutlined />}
            disabled={!canManage}
            onClick={() => navigate('/grant-rules/new')}
          >
            新建规则
          </Button>,
          <Button
            key="dryrun"
            icon={<ExperimentOutlined />}
            onClick={() => message.info('模拟运行：选择具体规则后点详情页内的模拟触发')}
          >
            模拟运行
          </Button>,
        ]}
      />

      <StatCardGroup columns={4}>
        <StatCard label="规则总数" value={stats.total} />
        <StatCard label="今日已发放" value={stats.todayGranted} />
        <StatCard label="30 天发放总额" value={stats.total30d} />
        <StatCard label="受益用户数" value={stats.benefitedUsers} />
      </StatCardGroup>

      <FilterBar
        search={{
          placeholder: '搜索规则名',
          onSearch: (v) => {
            setSearch(v);
          },
        }}
        filters={[
          <Select
            key="trigger"
            placeholder="触发方式"
            allowClear
            style={{ minWidth: 140 }}
            value={triggerFilter}
            onChange={(v) => {
              setTriggerFilter(v);
            }}
            options={Object.entries(TRIGGER_LABEL).map(([v, l]) => ({
              value: v,
              label: l,
            }))}
          />,
          <Select
            key="segment"
            placeholder="适用分群"
            allowClear
            style={{ minWidth: 160 }}
            value={segmentFilter}
            onChange={setSegmentFilter}
            options={segments.map((s) => ({ label: s.name, value: s.id }))}
          />,
          <Select
            key="active"
            placeholder="状态"
            allowClear
            style={{ minWidth: 120 }}
            value={activeFilter}
            onChange={(v) => {
              setActiveFilter(v);
            }}
            options={[
              { label: '启用', value: true },
              { label: '停用', value: false },
            ]}
          />,
        ]}
      />

      {filteredItems.length === 0 && !grantRules.loading ? (
        <EmptyPlaceholder
          title="暂无规则"
          description="尚未创建任何定时奖励规则。"
        />
      ) : (
        <DataTable<CreditGrantRule>
          columns={columns}
          dataSource={filteredItems}
          rowKey="id"
          loading={grantRules.loading}
          listPagination={grantRules.tablePagination}
          scroll={{ x: 1100 }}
        />
      )}
    </div>
  );
}
