import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Alert, App, Button, Input, Segmented, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DownloadOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { financeReportsApi } from '../../api/admin';
import { DataTable, PageHeader } from '../../components/common';
import { usePermission } from '../../hooks/usePermission';
import './FinanceExportJobs.css';

type ExportJobStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
type ExportStatusFilter = 'ALL' | ExportJobStatus;

interface FinanceExportJob {
  id: string;
  month: string;
  tab: string;
  billingMode?: string | null;
  status: ExportJobStatus;
  filename: string;
  rowCount?: number | null;
  processedRows?: number | null;
  totalRows?: number | null;
  fileSizeBytes?: number | null;
  errorCode?: string | null;
  failedStage?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  finishedAt?: string | null;
}

const EXPORT_JOB_TAKE = 1000;
const EXPORT_JOB_LOAD_TIMEOUT_MS = 15_000;

const STATUS_META: Record<ExportJobStatus, { label: string; color: string }> = {
  PENDING: { label: '等待中', color: 'default' },
  RUNNING: { label: '生成中', color: 'processing' },
  SUCCEEDED: { label: '已完成', color: 'green' },
  FAILED: { label: '失败', color: 'red' },
};

const BILLING_MODE_LABELS: Record<string, string> = {
  SUBSCRIPTION: '订阅',
  PAY_AS_YOU_GO: '按量',
  CODING_PLAN: 'CodingPlan',
  ALL: '全部',
};

const REPORT_TAB_LABELS: Record<string, string> = {
  pureGiftAccountChanges: '账户变动明细',
  pureGiftConsumptionDetails: '当期消耗明细',
  pureGiftConsumptionSummary: '当期消耗汇总',
  buyGiftAccountChanges: '账户变动明细',
  buyGiftAccountSummary: '账户变动汇总',
  buyGiftConsumptionDetails: '当期消耗明细',
  buyGiftConsumptionSummary: '当期消耗汇总',
  buyGiftPaymentDetails: '收付款明细',
  buyGiftPaymentSummary: '收付款汇总',
  enterpriseCreditConsumptionDetails: '企业信用消耗明细',
  enterpriseCreditConsumptionSummary: '企业信用消耗汇总',
  enterpriseCreditSettlement: '企业信用结算对账',
  tokenPlanRevenueSummary: '收入确认汇总',
  tokenPlanRevenueDetails: '收入确认明细',
  tokenPlanRevenueNotes: '口径说明',
  templateNotes: '字段口径',
  summary: '月度对账汇总',
  orders: '收入订单明细',
  payments: '收款渠道对账',
  balance: '余额流水明细',
  balanceGrants: '充值批次',
  balanceAllocations: '余额消耗分摊',
  credits: '积分套餐流水',
  apiUsage: 'API 用量扣费',
  supplier: '供应商成本',
  gaps: '字段映射与缺口',
};

function formatDate(value?: string | null) {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '—';
}

function formatNumber(value?: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—';
}

function getDisplayedRowCount(job: FinanceExportJob) {
  if (job.status === 'FAILED') return 0;
  return job.status === 'SUCCEEDED' ? job.rowCount : job.processedRows;
}

function isRunningJob(job: FinanceExportJob) {
  return job.status === 'PENDING' || job.status === 'RUNNING';
}

function jobMatchesKeyword(job: FinanceExportJob, keyword: string) {
  const q = keyword.trim().toLowerCase();
  if (!q) return true;
  return [
    job.filename,
    job.month,
    job.tab,
    REPORT_TAB_LABELS[job.tab],
    job.billingMode ? BILLING_MODE_LABELS[job.billingMode] ?? job.billingMode : undefined,
    STATUS_META[job.status]?.label,
  ].some((value) => value?.toLowerCase().includes(q));
}

function getExportJobLoadError(error: unknown) {
  if (axios.isAxiosError(error)) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return '导出任务加载超时，请稍后重试';
    }
    const responseMessage = error.response?.data?.message;
    if (typeof responseMessage === 'string' && responseMessage.trim()) {
      return responseMessage;
    }
  }
  return '导出任务加载失败';
}

export default function FinanceExportJobsPage() {
  const { message } = App.useApp();
  const canDownload = usePermission('admin.page.finance_export_jobs.download');
  const [jobs, setJobs] = useState<FinanceExportJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloadJobId, setDownloadJobId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ExportStatusFilter>('ALL');
  const [keyword, setKeyword] = useState('');
  const loadRequestRef = useRef(0);

  const load = useCallback((silent = false) => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    if (!silent) {
      setLoading(true);
      setLoadError(null);
    }
    financeReportsApi
      .listExportJobs({ take: EXPORT_JOB_TAKE }, { timeout: EXPORT_JOB_LOAD_TIMEOUT_MS })
      .then((result: { items?: FinanceExportJob[] }) => {
        if (requestId !== loadRequestRef.current) return;
        setJobs(result.items ?? []);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (requestId !== loadRequestRef.current) return;
        if (!silent) {
          const errorMessage = getExportJobLoadError(error);
          setLoadError(errorMessage);
          message.error(errorMessage);
        }
      })
      .finally(() => {
        if (requestId !== loadRequestRef.current) return;
        if (!silent) setLoading(false);
      });
  }, [message]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!jobs.some(isRunningJob)) return undefined;
    const timer = window.setInterval(() => load(true), 3000);
    return () => window.clearInterval(timer);
  }, [jobs, load]);

  const handleDownload = useCallback((job: FinanceExportJob) => {
    setDownloadJobId(job.id);
    const link = document.createElement('a');
    link.href = `/api/admin/finance-reports/export-jobs/${encodeURIComponent(job.id)}/download`;
    link.download = job.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => setDownloadJobId(null), 500);
  }, []);

  const filteredJobs = useMemo(() => jobs.filter((job) => {
    if (statusFilter !== 'ALL' && job.status !== statusFilter) return false;
    return jobMatchesKeyword(job, keyword);
  }), [jobs, keyword, statusFilter]);

  const columns = useMemo<ColumnsType<FinanceExportJob>>(() => [
    {
      title: '文件',
      dataIndex: 'filename',
      key: 'filename',
      width: 300,
      render: (filename: string, job) => (
        <div className="finance-export-task-file">
          <Typography.Text strong ellipsis={{ tooltip: filename }}>{filename}</Typography.Text>
          <Typography.Text type="secondary" className="finance-export-task-id">{job.id}</Typography.Text>
        </div>
      ),
    },
    {
      title: '账期',
      dataIndex: 'month',
      key: 'month',
      width: 100,
    },
    {
      title: '报表',
      dataIndex: 'tab',
      key: 'tab',
      width: 170,
      render: (tab: string) => REPORT_TAB_LABELS[tab] ?? tab,
    },
    {
      title: '计费模式',
      dataIndex: 'billingMode',
      key: 'billingMode',
      width: 110,
      render: (mode?: string | null) => (mode ? BILLING_MODE_LABELS[mode] ?? mode : '全部'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (status: ExportJobStatus) => (
        <Tag color={STATUS_META[status].color}>{STATUS_META[status].label}</Tag>
      ),
    },
    {
      title: '行数',
      dataIndex: 'rowCount',
      key: 'rowCount',
      align: 'right',
      width: 110,
      render: (_rowCount: number | null | undefined, job) => formatNumber(getDisplayedRowCount(job)),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      defaultSortOrder: 'descend',
      sorter: (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
      render: formatDate,
    },
    {
      title: '完成时间',
      dataIndex: 'finishedAt',
      key: 'finishedAt',
      width: 170,
      render: formatDate,
    },
    {
      title: '错误信息',
      dataIndex: 'errorMessage',
      key: 'errorMessage',
      width: 220,
      render: (errorMessage: string | null | undefined, job) => (
        errorMessage
          ? (
            <Typography.Text
              type="danger"
              ellipsis={{
                tooltip: [job.errorCode, job.failedStage, errorMessage].filter(Boolean).join(' / '),
              }}
            >
              {errorMessage}
            </Typography.Text>
          )
          : <Typography.Text type="secondary">—</Typography.Text>
      ),
    },
    {
      title: '操作',
      key: 'action',
      fixed: 'right',
      width: 100,
      render: (_, job) => (
        canDownload ? (
          <Button
            size="small"
            type="link"
            icon={<DownloadOutlined />}
            disabled={job.status !== 'SUCCEEDED'}
            loading={downloadJobId === job.id}
            onClick={() => handleDownload(job)}
          >
            下载
          </Button>
        ) : <Typography.Text type="secondary">—</Typography.Text>
      ),
    },
  ], [canDownload, downloadJobId, handleDownload]);

  return (
    <div className="finance-export-tasks">
      <PageHeader
        title="导出任务"
        breadcrumb={[{ label: '财务中心', to: '/finance-overview' }, '导出任务']}
        actions={[
          <Button key="refresh" icon={<ReloadOutlined />} onClick={() => load()} loading={loading}>
            刷新
          </Button>,
        ]}
      />

      <div className="finance-export-tasks-toolbar">
        <Segmented
          value={statusFilter}
          onChange={(value) => setStatusFilter(value as ExportStatusFilter)}
          options={[
            { label: '全部', value: 'ALL' },
            { label: '生成中', value: 'RUNNING' },
            { label: '已完成', value: 'SUCCEEDED' },
            { label: '失败', value: 'FAILED' },
          ]}
        />
        <Input
          allowClear
          className="finance-export-tasks-search"
          prefix={<SearchOutlined />}
          placeholder="搜索文件、账期、报表"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <Typography.Text type="secondary" className="finance-export-tasks-count">
          共 {filteredJobs.length} 个
        </Typography.Text>
      </div>

      {loadError ? (
        <Alert
          showIcon
          type="error"
          message={loadError}
          action={(
            <Button size="small" onClick={() => load()} loading={loading}>
              重试
            </Button>
          )}
        />
      ) : null}

      <DataTable<FinanceExportJob>
        rowKey="id"
        columns={columns}
        dataSource={filteredJobs}
        loading={loading}
        scroll={{ x: 1460 }}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 个任务`,
        }}
        locale={{ emptyText: loading ? '加载中' : '暂无导出任务' }}
      />
    </div>
  );
}
