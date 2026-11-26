import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { App, Button, Form, Segmented } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { DataTable, FilterBar, PageHeader } from '../../components/common';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { usePermission } from '../../hooks/usePermission';
import { enterpriseAccountApi } from '../../api/v2/enterpriseAccounts';
import {
  enterpriseAccountV2Api,
  type EnterpriseAccountV2,
  type MonthSummaryCloseResult,
  type MonthSummaryRefreshResult,
} from '../../api/v2/enterpriseAccountsV2';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { CreateEnterpriseAccountModal } from '../EnterpriseAccounts/components/EnterpriseAccountModals';
import { accountStatusTag, fmtDateTime, formatMoneyCents, moneyText } from './formatters';
import { ReviewQueuePanel } from './ReviewQueuePanel';
import './enterpriseAccountsV2.css';
import { CreationEntry } from '../EnterpriseAdminCreation/CreationEntry';

export default function EnterpriseAccountsV2Page() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [params, setSearchParams] = useSearchParams();
  const mode = params.get('tab') === 'review' ? 'review' : 'billing';
  const search = params.get('q') ?? '';
  const page = Math.max(1, parseInt(params.get('page') ?? '1', 10) || 1);
  const pageSize = Math.max(1, parseInt(params.get('pageSize') ?? '10', 10) || 10);
  const [createOpen, setCreateOpen] = useState(false);
  const [acting, setActing] = useState(false);
  const [jobActing, setJobActing] = useState<'refresh' | 'close' | null>(null);
  const [createForm] = Form.useForm();
  const canManage = usePermission('admin.page.enterprise_accounts.manage');
  const canReview = usePermission('admin.page.enterprise_accounts.review');
  const currency = usePlatformCurrency();
  const jobBusy = jobActing != null;

  const accounts = usePaginatedList<EnterpriseAccountV2>({
    fetcher: (query) => enterpriseAccountV2Api.list({
      page: query.page,
      pageSize: query.pageSize,
      search: search || undefined,
    }),
    pageSize,
    deps: [search],
    enabled: mode === 'billing',
    onError: () => message.error('加载企业账户失败'),
  });

  // story 8：返回列表要保住 Tab、搜索词和分页，分页先写进 URL。
  useEffect(() => {
    if (mode !== 'billing') return;
    if (accounts.page !== page || accounts.pageSize !== pageSize) {
      accounts.setPagination(page, pageSize);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, page, pageSize, accounts.loading]);

  const listQuery = useMemo(() => {
    const next = new URLSearchParams();
    if (mode === 'review') next.set('tab', 'review');
    if (search) next.set('q', search);
    if (page > 1) next.set('page', String(page));
    if (pageSize !== 10) next.set('pageSize', String(pageSize));
    return next.toString();
  }, [mode, search, page, pageSize]);

  function syncPage(nextPage: number, nextPageSize: number) {
    const next = new URLSearchParams(params);
    if (nextPage > 1) next.set('page', String(nextPage));
    else next.delete('page');
    if (nextPageSize !== 10) next.set('pageSize', String(nextPageSize));
    else next.delete('pageSize');
    setSearchParams(next);
  }

  async function runMonthSummaryJob(kind: 'refresh' | 'close') {
    if (jobActing) return;
    setJobActing(kind);
    try {
      if (kind === 'refresh') {
        const data = await enterpriseAccountV2Api.refreshMonthSummaries();
        notifyRefreshResult(message, data);
        if (!data.skipped) accounts.reload();
      } else {
        const data = await enterpriseAccountV2Api.closeHistoricalMonths();
        notifyCloseResult(message, data);
        if (!data.skipped) accounts.reload();
      }
    } catch (err) {
      message.error((err as Error)?.message || (kind === 'refresh' ? '刷新当月快照失败' : '关闭历史月失败'));
    } finally {
      setJobActing(null);
    }
  }

  return (
    <div className="ea-v2-page">
      <PageHeader
        title="企业账户"
        subtitle="审核队列（待审核 / 待付款 / 驳回 / 开通失败）来自 user 侧申请单；已开户账务列表来自 billing。支持人工审核、创建/补救、挂载 tenant、开通失败重试与凭证短时效查看。"
        actions={[<CreationEntry key="admin-create" />, ...(canReview?[<Button key="records" onClick={()=>navigate(`/enterprise-accounts-v2/admin-creations?${params.toString()}`)}>代办记录</Button>]:[]), ...(mode === 'billing' && canManage ? [
          <Button
            key="refresh-month"
            hidden
            style={{ display: 'none' }}
            loading={jobActing === 'refresh'}
            disabled={jobBusy && jobActing !== 'refresh'}
            onClick={() => void runMonthSummaryJob('refresh')}
          >
            刷新当月快照
          </Button>,
          <Button
            key="close-months"
            hidden
            style={{ display: 'none' }}
            loading={jobActing === 'close'}
            disabled={jobBusy && jobActing !== 'close'}
            onClick={() => void runMonthSummaryJob('close')}
          >
            关闭历史月
          </Button>,
          <Button
            key="create"
            type="primary"
            icon={<PlusOutlined />}
            disabled={jobBusy}
            hidden
            style={{ display: 'none' }}
            onClick={() => setCreateOpen(true)}
          >
            创建 / 补救
          </Button>,
        ] : [])]}
      />

      <Segmented
        style={{ marginBottom: 16 }}
        value={mode}
        options={[
          { label: '已开户账务', value: 'billing' },
          { label: '待审核队列', value: 'review' },
        ]}
        onChange={(value) => {
          const next = new URLSearchParams();
          if (value === 'review') next.set('tab', 'review');
          else if (search) next.set('q', search);
          setSearchParams(next);
        }}
      />

      {mode === 'billing' ? (
        <>
          <FilterBar
            search={{
              placeholder: '企业名称 / 统一社会信用代码 / 手机号',
              value: search,
              onSearch: (value) => {
                const next = new URLSearchParams(params);
                if (value) next.set('q', value);
                else next.delete('q');
                next.delete('page');
                setSearchParams(next);
              },
            }}
            rightActions={
              <Button icon={<ReloadOutlined />} onClick={() => accounts.reload()}>
                刷新
              </Button>
            }
          />
          <DataTable<EnterpriseAccountV2>
            rowKey="id"
            loading={accounts.loading}
            dataSource={accounts.items}
            listPagination={{ ...accounts.tablePagination, onChange: syncPage }}
            rowClassName={(row) => (row.dueWarning ? 'ea-v2-row-due' : '')}
            scroll={{ x: 'max-content' }}
            columns={[
              {
                title: '企业名称',
                className: 'ea-v2-col-nowrap',
                render: (_: unknown, row) => row.enterpriseName || row.name || '—',
              },
              {
                title: '统一社会信用代码',
                dataIndex: 'uscc',
                className: 'ea-v2-col-nowrap',
                render: (value: string | null) => value || '—',
              },
              {
                title: '手机号',
                dataIndex: 'phone',
                className: 'ea-v2-col-nowrap',
                render: (value: string | null) => value || '—',
              },
              {
                title: '账户状态',
                dataIndex: 'status',
                className: 'ea-v2-col-nowrap',
                render: (value: string | null) => accountStatusTag(value),
              },
              {
                title: '资金处理方式',
                className: 'ea-v2-col-funding',
                // 列表只展示「预付款 / 信用额度」，不展开回款细则（账户信息仍用 fundingModeText）
                render: (_: unknown, row) => (row.prepaid ? '预付款' : '信用额度'),
              },
              {
                title: '余额',
                align: 'right',
                className: 'ea-v2-col-nowrap',
                onHeaderCell: () => ({ style: { textAlign: 'left' } }),
                render: (_: unknown, row) => moneyText(row.credit?.accountBalanceCents, currency),
              },
              {
                title: '剩余信用',
                align: 'right',
                className: 'ea-v2-col-nowrap',
                onHeaderCell: () => ({ style: { textAlign: 'left' } }),
                render: (_: unknown, row) => formatMoneyCents(row.credit?.remainingCents, currency),
              },
              {
                title: '账期到期时间',
                align: 'center',
                className: 'ea-v2-col-nowrap',
                render: (_: unknown, row) => {
                  if (!row.earliestDueAt) return '—';
                  return (
                    <span className={row.earliestDueProjected ? 'ea-v2-due-projected' : undefined}>
                      {fmtDateTime(row.earliestDueAt).slice(0, 10)}
                    </span>
                  );
                },
              },
              {
                title: '操作',
                align: 'center',
                className: 'ea-v2-col-nowrap',
                render: (_: unknown, row) => (
                  <Button
                    type="link"
                    onClick={() => navigate(`/enterprise-accounts-v2/${row.id}?${listQuery}`)}
                  >
                    详情
                  </Button>
                ),
              },
            ]}
          />
        </>
      ) : (
        <ReviewQueuePanel />
      )}

      <CreateEnterpriseAccountModal
        open={createOpen}
        form={createForm}
        acting={acting}
        onOk={async () => {
          const values = await createForm.validateFields();
          setActing(true);
          try {
            // 与 V1 一致：走 POST /api/admin/enterprise-accounts（含 user 实名校验再透传 billing）
            await enterpriseAccountApi.create({
              userId: values.userId.trim(),
              verificationId: values.verificationId?.trim() || undefined,
              tenantId: values.tenantId?.trim() || undefined,
            });
            message.success('企业账户已创建/补救');
            setCreateOpen(false);
            createForm.resetFields();
            accounts.reload();
          } catch (err) {
            message.error((err as Error)?.message || '创建失败');
          } finally {
            setActing(false);
          }
        }}
        onCancel={() => setCreateOpen(false)}
      />
    </div>
  );
}

type JobMessage = {
  success: (content: string) => void;
  warning: (content: string) => void;
};

function notifyRefreshResult(message: JobMessage, data: MonthSummaryRefreshResult) {
  if (data.skipped) {
    message.warning('当月快照作业进行中，请稍后再试');
    return;
  }
  message.success(
    `当月快照已刷新（${data.yearMonth ?? '—'}，账户 ${data.processed}，资金快照 ${data.fundingProcessed}）`,
  );
}

function notifyCloseResult(message: JobMessage, data: MonthSummaryCloseResult) {
  if (data.skipped) {
    message.warning('关闭历史月作业进行中，请稍后再试');
    return;
  }
  if (data.processed === 0) {
    message.success('没有需要关闭的历史月');
    return;
  }
  const months = data.yearMonths?.length ? data.yearMonths.join('、') : (data.yearMonth ?? '—');
  message.success(`已关闭历史月 ${months}（${data.processed} 户月）`);
}
