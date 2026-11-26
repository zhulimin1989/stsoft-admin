import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Checkbox,
  DatePicker,
  Descriptions,
  Divider,
  Drawer,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import {
  CheckCircleOutlined,
  DownloadOutlined,
  FileSearchOutlined,
  PlusOutlined,
  ReloadOutlined,
  UploadOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import {
  historicalPlatformLossApi,
  type HistoricalPlatformLossBatchInput,
  type HistoricalPlatformLossBatchRow,
  type HistoricalPlatformLossIssue,
  type HistoricalPlatformLossLineRow,
  type HistoricalPlatformLossPreview,
  type HistoricalPlatformLossTotals,
} from '../../api/admin';
import { DataTable, PageHeader } from '../../components/common';
import { usePermission } from '../../hooks/usePermission';
import { useAuthStore } from '../../stores/auth-store';
import {
  buildHistoricalPlatformLossLines,
  parseNormalizedUsageFile,
  parsePricingEvidenceFile,
  sha256File,
  PRICING_EVIDENCE_JSON_TEMPLATE,
  STANDARD_USAGE_CSV_TEMPLATE,
  type FileParseIssue,
  type ParsedUsageFile,
  type ParsedPricingEvidenceFile,
} from './loss-file';
import './HistoricalPlatformLosses.css';

const { RangePicker } = DatePicker;
const { Text, Paragraph } = Typography;

type LossBatchFilter = {
  status?: string;
  provider?: string;
  providerAccountRef?: string;
  region?: string;
  period?: [Dayjs, Dayjs];
};

type PrepareForm = {
  provider: string;
  providerAccountRef: string;
  region: string;
  period: [Dayjs, Dayjs];
  currency: string;
  sourceFileRef: string;
  sourceFileSha256: string;
  valuationVersion: string;
  calculationMethod: 'TOKEN_RATE_PER_MILLION_V1';
  roundingPolicy: 'HALF_UP_12';
  exchangeRate?: string;
  exchangeRateSource?: string;
  exchangeRateSourceCurrency?: string;
  exchangeRateAsOf?: Dayjs;
  reason: string;
};

type ApprovalForm = {
  reason: string;
  confirmNoCustomerImpact: boolean;
};

const statusColors: Record<string, string> = {
  PREPARED: 'processing',
  POSTED: 'success',
};

const issueColors: Record<string, string> = {
  SETTLEMENT_ANCHOR_PRESENT: 'gold',
  SOURCE_EVIDENCE_REQUIRED: 'error',
  RECOGNITION_ALREADY_CLAIMED: 'error',
};

function actionIdempotencyKey(action: string, identity: string): string {
  const random = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `admin:historical-platform-loss:${action}:${identity}:${random}`;
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { message?: unknown } } }).response;
    if (typeof response?.data?.message === 'string') return response.data.message;
  }
  return error instanceof Error ? error.message : '操作失败';
}

function formatTime(value?: string | null): string {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '—';
}

function shortHash(value?: string | null): string {
  if (!value) return '—';
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

function decimalDisplay(value?: string | null): string {
  if (value == null || value === '') return '—';
  return value;
}

function downloadText(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function lineBlockedReason(
  line: HistoricalPlatformLossLineRow,
  issues: HistoricalPlatformLossIssue[],
): string | null {
  const issue = issues.find((item) => item.lineNumber === line.lineNumber);
  return issue?.message ?? null;
}

export function historicalPlatformLossApprovalIssue(
  batch: Pick<HistoricalPlatformLossBatchRow, 'status' | 'makerActorId'>,
  actor: { id?: string; presetRole?: string } | null | undefined,
  hasApprovePermission: boolean,
): string | null {
  if (batch.status !== 'PREPARED') return '只有 PREPARED 批次可以审批入账';
  if (!hasApprovePermission) return '缺少 approve_post 权限';
  if (!['finance', 'super_admin'].includes(String(actor?.presetRole ?? '').toLowerCase())) {
    return '只有 Finance 或 Super Admin 可以审批入账';
  }
  if (!actor?.id) return '缺少当前审批人身份';
  if (batch.makerActorId === actor.id) return 'Maker-checker：创建人不能审批自己的批次';
  return null;
}

function TotalsPanel({ totals, currency }: { totals?: HistoricalPlatformLossTotals | null; currency: string }) {
  if (!totals) return null;
  return (
    <div className="historical-loss-totals">
      <Statistic title={`平台原记录 (${currency})`} value={decimalDisplay(totals.platformAmountBefore)} />
      <Statistic title={`平台修正后 (${currency})`} value={decimalDisplay(totals.platformAmountCorrected)} />
      <Statistic title={`平台吸收 (${currency})`} value={decimalDisplay(totals.customerAbsorbedDelta)} />
      <Statistic title="客户补扣" value={decimalDisplay(totals.customerDeduction)} valueStyle={{ color: '#4A9B7F' }} />
      <Statistic title={`供应商成本差额 (${currency})`} value={decimalDisplay(totals.providerCostDelta)} />
    </div>
  );
}

function IssuesPanel({ issues }: { issues: Array<HistoricalPlatformLossIssue | FileParseIssue> }) {
  if (!issues.length) return null;
  return (
    <div className="historical-loss-issues">
      {issues.map((issue, index) => (
        <Alert
          key={`${issue.code}:${issue.lineNumber ?? 'batch'}:${index}`}
          type={issue.code === 'SETTLEMENT_ANCHOR_PRESENT' ? 'warning' : 'error'}
          showIcon
          message={(
            <Space wrap>
              {issue.lineNumber ? <Text>第 {issue.lineNumber} 行</Text> : null}
              <Tag color={issueColors[issue.code] ?? 'default'}>{issue.code}</Tag>
              <Text>{issue.message}</Text>
              {'action' in issue && issue.action === 'USE_ABSORB_DELTA' ? (
                <Link to={`/gateway-billing-events${issue.requestId ? `?requestId=${encodeURIComponent(issue.requestId)}` : ''}`}>
                  转到逐请求 absorb-delta
                </Link>
              ) : null}
            </Space>
          )}
        />
      ))}
    </div>
  );
}

export default function HistoricalPlatformLossesPage() {
  const { message } = App.useApp();
  const user = useAuthStore((state) => state.user);
  const canPrepare = usePermission('admin.page.historical_platform_losses.prepare');
  const canExport = usePermission('admin.page.historical_platform_losses.export');
  const hasApprovePermission = usePermission('admin.page.historical_platform_losses.approve_post');
  const [filterForm] = Form.useForm<LossBatchFilter>();
  const [prepareForm] = Form.useForm<PrepareForm>();
  const [approvalForm] = Form.useForm<ApprovalForm>();
  const [items, setItems] = useState<HistoricalPlatformLossBatchRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [prepareOpen, setPrepareOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sourceFiles, setSourceFiles] = useState<UploadFile[]>([]);
  const [normalizedFiles, setNormalizedFiles] = useState<UploadFile[]>([]);
  const [normalizedFile, setNormalizedFile] = useState<ParsedUsageFile | null>(null);
  const [pricingFiles, setPricingFiles] = useState<UploadFile[]>([]);
  const [pricingFile, setPricingFile] = useState<ParsedPricingEvidenceFile | null>(null);
  const [preview, setPreview] = useState<HistoricalPlatformLossPreview | null>(null);
  const [previewDraft, setPreviewDraft] = useState<HistoricalPlatformLossBatchInput | null>(null);
  const [createIdempotencyKey, setCreateIdempotencyKey] = useState('');
  const [detail, setDetail] = useState<HistoricalPlatformLossBatchRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [approvalTarget, setApprovalTarget] = useState<HistoricalPlatformLossBatchRow | null>(null);
  const [approving, setApproving] = useState(false);

  const load = useCallback(async (nextPage = 1) => {
    const filters = filterForm.getFieldsValue();
    setLoading(true);
    try {
      const result = await historicalPlatformLossApi.list({
        page: nextPage,
        pageSize: 20,
        status: filters.status || undefined,
        provider: filters.provider?.trim() || undefined,
        providerAccountRef: filters.providerAccountRef?.trim() || undefined,
        region: filters.region?.trim() || undefined,
        periodStart: filters.period?.[0]?.format('YYYY-MM-DD'),
        periodEnd: filters.period?.[1]?.add(1, 'day').format('YYYY-MM-DD'),
      });
      setItems(result.items);
      setTotal(result.total);
      setPage(nextPage);
    } catch (error) {
      message.error(`历史平台损失批次加载失败：${errorText(error)}`);
    } finally {
      setLoading(false);
    }
  }, [filterForm, message]);

  useEffect(() => {
    void load(1);
  }, [load]);

  const resetPreview = useCallback(() => {
    setPreview(null);
    setPreviewDraft(null);
    setCreateIdempotencyKey('');
  }, []);

  const openPrepare = () => {
    prepareForm.resetFields();
    prepareForm.setFieldsValue({
      currency: 'CNY',
      calculationMethod: 'TOKEN_RATE_PER_MILLION_V1',
      roundingPolicy: 'HALF_UP_12',
    });
    setSourceFiles([]);
    setNormalizedFiles([]);
    setNormalizedFile(null);
    setPricingFiles([]);
    setPricingFile(null);
    resetPreview();
    setPrepareOpen(true);
  };

  const chooseSourceFile = async (file: File) => {
    resetPreview();
    setSourceFiles([file as unknown as UploadFile]);
    prepareForm.setFieldValue('sourceFileSha256', '');
    try {
      const hash = await sha256File(file);
      prepareForm.setFieldValue('sourceFileSha256', hash);
      message.success('原始来源文件 SHA-256 已在本地计算');
    } catch (error) {
      message.error(`文件哈希计算失败：${errorText(error)}`);
    }
    return false;
  };

  const chooseNormalizedFile = async (file: File) => {
    resetPreview();
    setNormalizedFiles([file as unknown as UploadFile]);
    setNormalizedFile(null);
    try {
      const parsed = await parseNormalizedUsageFile(file);
      setNormalizedFile(parsed);
      if (!sourceFiles.length && !prepareForm.getFieldValue('sourceFileSha256')) {
        prepareForm.setFieldValue('sourceFileSha256', parsed.sha256);
      }
      if (parsed.issues.length) {
        message.warning(`标准明细有 ${parsed.issues.length} 个问题，请修正后重新选择`);
      } else {
        message.success(`已解析 ${parsed.rows.length} 条标准用量明细`);
      }
    } catch (error) {
      message.error(`标准明细读取失败：${errorText(error)}`);
    }
    return false;
  };

  const choosePricingFile = async (file: File) => {
    resetPreview();
    setPricingFiles([file as unknown as UploadFile]);
    setPricingFile(null);
    try {
      const parsed = await parsePricingEvidenceFile(file);
      setPricingFile(parsed);
      if (parsed.issues.length) {
        message.warning(`历史价目证据有 ${parsed.issues.length} 个问题，请修正后重新选择`);
      } else {
        message.success(`已验证并哈希 ${parsed.entries.length} 条历史价目证据`);
      }
    } catch (error) {
      message.error(`历史价目证据读取失败：${errorText(error)}`);
    }
    return false;
  };

  const buildDraft = async (): Promise<HistoricalPlatformLossBatchInput> => {
    const values = await prepareForm.validateFields();
    if (!normalizedFile) throw new Error('请先选择标准 CSV/JSON 明细文件');
    if (normalizedFile.issues.length) throw new Error('标准明细仍有解析问题，不能预检');
    if (!pricingFile) throw new Error('请先选择已审批历史价目证据 JSON');
    if (pricingFile.issues.length) throw new Error('历史价目证据仍有问题，不能预检');
    const built = buildHistoricalPlatformLossLines(normalizedFile.rows, {
      version: values.valuationVersion,
      pricingCurrency: values.currency,
    }, pricingFile.entries);
    if (built.issues.length) {
      throw new Error(built.issues[0].message);
    }
    const [periodStart, periodEnd] = values.period;
    return {
      provider: values.provider.trim(),
      providerAccountRef: values.providerAccountRef.trim(),
      region: values.region.trim(),
      periodStart: periodStart.format('YYYY-MM-DD'),
      periodEnd: periodEnd.add(1, 'day').format('YYYY-MM-DD'),
      currency: values.currency.trim().toUpperCase(),
      sourceFileRef: values.sourceFileRef.trim(),
      sourceFileSha256: values.sourceFileSha256.trim().toLowerCase(),
      calculationMethod: values.calculationMethod,
      roundingPolicy: values.roundingPolicy,
      ...(values.exchangeRate?.trim() ? { exchangeRate: values.exchangeRate.trim() } : {}),
      ...(values.exchangeRateSource?.trim() ? { exchangeRateSource: values.exchangeRateSource.trim() } : {}),
      ...(values.exchangeRateSourceCurrency?.trim()
        ? { exchangeRateSourceCurrency: values.exchangeRateSourceCurrency.trim().toUpperCase() }
        : {}),
      ...(values.exchangeRateAsOf ? { exchangeRateAsOf: values.exchangeRateAsOf.toISOString() } : {}),
      reason: values.reason.trim(),
      lines: built.lines,
    };
  };

  const runPreview = async () => {
    setPreparing(true);
    try {
      const draft = await buildDraft();
      const result = await historicalPlatformLossApi.preview(draft);
      setPreviewDraft(draft);
      setPreview(result);
      if (result.status === 'READY' && result.fingerprint && result.totals) {
        setCreateIdempotencyKey(actionIdempotencyKey('prepare', result.fingerprint));
        message.success('服务端预检通过，可创建待审批批次');
      } else {
        setCreateIdempotencyKey('');
        message.warning(`服务端阻断了批次：${result.issues.length} 个问题`);
      }
    } catch (error) {
      message.error(`预检失败：${errorText(error)}`);
    } finally {
      setPreparing(false);
    }
  };

  const createBatch = async () => {
    if (!preview || preview.status !== 'READY' || !preview.fingerprint || !previewDraft) return;
    setCreating(true);
    try {
      const created = await historicalPlatformLossApi.create({
        ...previewDraft,
        expectedFingerprint: preview.fingerprint,
        idempotencyKey: createIdempotencyKey,
      });
      message.success('批次已准备；必须由另一位 Finance/Super Admin 审批入账');
      setPrepareOpen(false);
      await load(1);
      await showDetail(created.id);
    } catch (error) {
      message.error(`创建批次失败：${errorText(error)}`);
    } finally {
      setCreating(false);
    }
  };

  const showDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const result = await historicalPlatformLossApi.get(id);
      setDetail(result);
    } catch (error) {
      message.error(`批次详情加载失败：${errorText(error)}`);
    } finally {
      setDetailLoading(false);
    }
  }, [message]);

  const exportBatch = useCallback(async (row: HistoricalPlatformLossBatchRow) => {
    try {
      const result = await historicalPlatformLossApi.export(row.id);
      downloadText(
        `historical-platform-loss-${row.id}.json`,
        `${JSON.stringify(result, null, 2)}\n`,
        'application/json;charset=utf-8',
      );
      message.success('审计导出已下载');
    } catch (error) {
      message.error(`导出失败：${errorText(error)}`);
    }
  }, [message]);

  const openApproval = (row: HistoricalPlatformLossBatchRow) => {
    approvalForm.resetFields();
    approvalForm.setFieldsValue({ confirmNoCustomerImpact: false });
    setApprovalTarget(row);
  };

  const approveAndPost = async () => {
    if (!approvalTarget) return;
    const values = await approvalForm.validateFields();
    setApproving(true);
    try {
      const result = await historicalPlatformLossApi.approveAndPost(approvalTarget.id, {
        expectedRevision: approvalTarget.revision,
        expectedFingerprint: approvalTarget.fingerprint,
        reason: values.reason.trim(),
        idempotencyKey: actionIdempotencyKey('approve-post', approvalTarget.id),
      });
      setApprovalTarget(null);
      setDetail(result);
      message.success('平台损失已入账；客户账单与余额未改变');
      await load(page);
    } catch (error) {
      message.error(`审批入账失败：${errorText(error)}`);
    } finally {
      setApproving(false);
    }
  };

  const listColumns = useMemo<ColumnsType<HistoricalPlatformLossBatchRow>>(() => [
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (status: string) => <Tag color={statusColors[status] ?? 'default'}>{status}</Tag>,
    },
    {
      title: '供应商 / 账号',
      width: 220,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text strong>{row.provider}</Text>
          <Text type="secondary" copyable>{row.providerAccountRef}</Text>
        </Space>
      ),
    },
    {
      title: '地区 / 账期',
      width: 230,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text>{row.region}</Text>
          <Text type="secondary">{row.periodStart} → {row.periodEnd}</Text>
        </Space>
      ),
    },
    {
      title: '平台吸收',
      width: 170,
      render: (_, row) => `${row.currency} ${decimalDisplay(row.totals?.customerAbsorbedDelta)}`,
    },
    {
      title: '供应商差额',
      width: 170,
      render: (_, row) => `${row.currency} ${decimalDisplay(row.totals?.providerCostDelta)}`,
    },
    {
      title: '文件 / 指纹',
      width: 250,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text code copyable={{ text: row.sourceFileSha256 }}>文件 {shortHash(row.sourceFileSha256)}</Text>
          <Text code copyable={{ text: row.fingerprint }}>批次 {shortHash(row.fingerprint)}</Text>
        </Space>
      ),
    },
    { title: '行数', dataIndex: 'itemCount', width: 90 },
    { title: '创建时间', dataIndex: 'createdAt', width: 180, render: formatTime },
    {
      title: '操作',
      fixed: 'right',
      width: 170,
      render: (_, row) => (
        <Space>
          <Button size="small" onClick={() => void showDetail(row.id)}>详情</Button>
          <Button size="small" disabled={!canExport} onClick={() => void exportBatch(row)}>导出</Button>
        </Space>
      ),
    },
  ], [canExport, exportBatch, showDetail]);

  const lineColumns = useMemo<ColumnsType<HistoricalPlatformLossLineRow>>(() => [
    { title: '行', dataIndex: 'lineNumber', width: 70 },
    {
      title: '日期 / 模型',
      width: 210,
      render: (_, row) => <><div>{row.serviceDate}</div><Text type="secondary">{row.model}</Text></>,
    },
    { title: 'Meter', dataIndex: 'meter', width: 110 },
    { title: '平台用量', dataIndex: 'platformUsage', width: 150 },
    { title: '供应商用量', dataIndex: 'providerUsage', width: 150 },
    { title: '用量差', dataIndex: 'usageDelta', width: 140, render: decimalDisplay },
    {
      title: '历史费率依据',
      width: 360,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text code>{row.valuationBasis.version}</Text>
          <Text type="secondary">
            客户 {row.valuationBasis.customerRatePerMillion} / 成本 {row.valuationBasis.providerCostRatePerMillion}
          </Text>
          <Text type="secondary" copyable={{ text: row.valuationBasis.pricingSourceRef }}>
            文档 {shortHash(row.valuationBasis.pricingDocumentSha256)} / 条目 {shortHash(row.valuationBasis.pricingEvidenceHash)}
          </Text>
          <Text type="secondary">
            {row.valuationBasis.pricingEffectiveFrom} → {row.valuationBasis.pricingEffectiveTo} · {row.valuationBasis.pricingApprovedBy}
          </Text>
        </Space>
      ),
    },
    { title: '平台吸收', dataIndex: 'customerAbsorbedDelta', width: 140, render: decimalDisplay },
    { title: '供应商差额', dataIndex: 'providerCostDelta', width: 140, render: decimalDisplay },
    {
      title: '校验',
      width: 260,
      render: (_, row) => {
        const reason = lineBlockedReason(row, detail ? [] : preview?.issues ?? []);
        return reason ? <Text type="danger">{reason}</Text> : <Tag color="success">可入账</Tag>;
      },
    },
  ], [detail, preview?.issues]);

  const detailApprovalIssue = detail
    ? historicalPlatformLossApprovalIssue(detail, user, hasApprovePermission)
    : null;
  const detailCanApprove = Boolean(detail && detailApprovalIssue === null);
  const makerConflict = Boolean(detail && user?.id && detail.makerActorId === user.id);

  return (
    <div className="historical-loss-page">
      <PageHeader
        title="历史平台损失"
        subtitle="处理无逐请求结算锚点的历史供应商聚合差额。客户补扣恒为 0；有锚点请求必须转逐请求 absorb-delta。"
        breadcrumb={[{ label: '财务中心', to: '/finance-overview' }, '历史平台损失']}
        actions={[
          <Button key="reload" icon={<ReloadOutlined />} onClick={() => void load(page)}>刷新</Button>,
          <Button key="create" type="primary" icon={<PlusOutlined />} disabled={!canPrepare} onClick={openPrepare}>
            准备批次
          </Button>,
        ]}
      />

      <Alert
        className="historical-loss-policy"
        type="info"
        showIcon
        message="这是平台承担损失的财务事实，不会补扣客户"
        description="批次入账不会修改已出账单、客户余额或原 TokenUsage。创建人与审批人必须不同，审批只允许 Finance / Super Admin。"
      />

      <Form form={filterForm} layout="inline" className="historical-loss-filters" onFinish={() => void load(1)}>
        <Form.Item name="status">
          <Select allowClear placeholder="状态" style={{ width: 140 }} options={[
            { value: 'PREPARED', label: 'PREPARED' },
            { value: 'POSTED', label: 'POSTED' },
          ]} />
        </Form.Item>
        <Form.Item name="provider"><Input allowClear placeholder="供应商" /></Form.Item>
        <Form.Item name="providerAccountRef"><Input allowClear placeholder="供应商账号" /></Form.Item>
        <Form.Item name="region"><Input allowClear placeholder="地区" /></Form.Item>
        <Form.Item name="period"><RangePicker /></Form.Item>
        <Form.Item><Button htmlType="submit" type="primary">查询</Button></Form.Item>
      </Form>

      <DataTable<HistoricalPlatformLossBatchRow>
        rowKey="id"
        columns={listColumns}
        dataSource={items}
        loading={loading}
        scroll={{ x: 1600 }}
        listPagination={{
          current: page,
          pageSize: 20,
          total,
          onChange: (next) => void load(next),
        }}
      />

      <Drawer
        title="准备历史平台损失批次"
        width="min(1120px, 96vw)"
        open={prepareOpen}
        onClose={() => setPrepareOpen(false)}
        destroyOnClose
        extra={(
          <Space>
            <Button onClick={() => setPrepareOpen(false)}>取消</Button>
            <Button icon={<FileSearchOutlined />} loading={preparing} onClick={() => void runPreview()}>服务端预检</Button>
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              disabled={preview?.status !== 'READY' || !preview.fingerprint || !preview.totals}
              loading={creating}
              onClick={() => void createBatch()}
            >
              创建待审批批次
            </Button>
          </Space>
        )}
      >
        <Alert
          type="warning"
          showIcon
          message="Excel 原件先绑定 SHA-256，再使用标准 CSV/JSON 明细"
          description="浏览器不会伪装读取 .xlsx。请先将原件存入受控对象存储并填写永久引用，然后按模板转换明细；服务端只根据 Token 用量和冻结历史费率重算金额。"
        />
        <Form
          form={prepareForm}
          layout="vertical"
          className="historical-loss-form"
          onValuesChange={resetPreview}
        >
          <div className="historical-loss-form-grid">
            <Form.Item label="供应商" name="provider" rules={[{ required: true }]}><Input placeholder="zhipu" /></Form.Item>
            <Form.Item label="供应商账号引用" name="providerAccountRef" rules={[{ required: true }, { max: 300 }]}>
              <Input maxLength={300} />
            </Form.Item>
            <Form.Item label="地区" name="region" rules={[{ required: true }]}><Input placeholder="domestic / overseas" /></Form.Item>
            <Form.Item label="账期（含首尾日期）" name="period" rules={[{ required: true }]}><RangePicker style={{ width: '100%' }} /></Form.Item>
            <Form.Item label="批次/计价币种" name="currency" rules={[{ required: true }, { pattern: /^[A-Za-z]{3}$/ }]}>
              <Input maxLength={3} />
            </Form.Item>
            <Form.Item label="历史价目版本" name="valuationVersion" rules={[{ required: true }, { max: 100 }]}>
              <Input maxLength={100} placeholder="例如 glm-2026-07-v1（必须与明细费率来源一致）" />
            </Form.Item>
            <Form.Item label="计算方法" name="calculationMethod" rules={[{ required: true }]}>
              <Select options={[{ value: 'TOKEN_RATE_PER_MILLION_V1', label: 'TOKEN_RATE_PER_MILLION_V1' }]} />
            </Form.Item>
            <Form.Item label="舍入策略" name="roundingPolicy" rules={[{ required: true }]}>
              <Select options={[{ value: 'HALF_UP_12', label: 'HALF_UP_12' }]} />
            </Form.Item>
          </div>

          <Divider orientation="left">原始来源证据</Divider>
          <div className="historical-loss-source-grid">
            <Form.Item label="本地选择原始文件（仅计算 SHA，不上传）">
              <Upload
                accept=".xlsx,.xls,.csv,.json"
                maxCount={1}
                fileList={sourceFiles}
                beforeUpload={(file) => { void chooseSourceFile(file); return false; }}
                onRemove={() => { setSourceFiles([]); resetPreview(); return true; }}
              >
                <Button icon={<UploadOutlined />}>选择 7 月原始文件</Button>
              </Upload>
            </Form.Item>
            <Form.Item
              label="原件永久存储引用"
              name="sourceFileRef"
              rules={[
                { required: true, message: '请先归档原件并填写不可变存储 URI/编号' },
                { max: 1000 },
              ]}
              tooltip="例如带版本号的对象存储 URI、财务归档编号；本页不把本地文件上传到服务器。"
            >
              <Input maxLength={1000} placeholder="oss://finance-evidence/.../7月api数据.xlsx?versionId=..." />
            </Form.Item>
            <Form.Item
              label="原件 SHA-256"
              name="sourceFileSha256"
              rules={[{ required: true }, { pattern: /^[a-fA-F0-9]{64}$/, message: '必须是 64 位 SHA-256' }]}
            >
              <Input className="historical-loss-mono" placeholder="可由本地文件计算，也可人工粘贴经复核的 hash" />
            </Form.Item>
          </div>

          <Divider orientation="left">标准明细与冻结费率</Divider>
          <Space wrap className="historical-loss-normalized-actions">
            <Upload
              accept=".csv,.json"
              maxCount={1}
              fileList={normalizedFiles}
              beforeUpload={(file) => { void chooseNormalizedFile(file); return false; }}
              onRemove={() => { setNormalizedFiles([]); setNormalizedFile(null); resetPreview(); return true; }}
            >
              <Button icon={<UploadOutlined />}>选择标准 CSV/JSON</Button>
            </Upload>
            <Button
              icon={<DownloadOutlined />}
              onClick={() => downloadText('historical-platform-loss-template.csv', STANDARD_USAGE_CSV_TEMPLATE, 'text/csv;charset=utf-8')}
            >
              下载标准 CSV 模板
            </Button>
            {normalizedFile ? <Tag color={normalizedFile.issues.length ? 'error' : 'success'}>{normalizedFile.rows.length} 条有效行</Tag> : null}
          </Space>
          <Paragraph type="secondary">
            原件第 1 行 D=智谱统计、E=软通统计，第 2 行 A=入账时间、B=模型编码（推理专用）、C=价格类型、D/E=求和项:用量。
            先将合并单元格造成的日期和模型空白向下填充，再逐行映射：A → serviceDate、B → model、C → meter、
            智谱统计(D) → providerUsage、软通统计(E) → platformUsage。价格类型须转换为 Billing 接受的 meter（如 INPUT/CACHE/OUTPUT）。
            不得直接把原表另存 CSV 后上传；必须转换成下载模板的一层表头和一行一个 date/model/meter。金额、差额和总损失不得由操作者填写。
          </Paragraph>
          <IssuesPanel issues={normalizedFile?.issues ?? []} />

          <div className="historical-loss-pricing-evidence">
            <Space wrap className="historical-loss-normalized-actions">
              <Upload
                accept=".json"
                maxCount={1}
                fileList={pricingFiles}
                beforeUpload={(file) => { void choosePricingFile(file); return false; }}
                onRemove={() => { setPricingFiles([]); setPricingFile(null); resetPreview(); return true; }}
              >
                <Button icon={<UploadOutlined />}>选择已审批历史价目证据 JSON</Button>
              </Upload>
              <Button
                icon={<DownloadOutlined />}
                onClick={() => downloadText(
                  'historical-pricing-evidence-template.json',
                  PRICING_EVIDENCE_JSON_TEMPLATE,
                  'application/json;charset=utf-8',
                )}
              >
                下载价目证据模板
              </Button>
              {pricingFile ? (
                <Tag color={pricingFile.issues.length ? 'error' : 'success'}>
                  {pricingFile.entries.length} 条价目证据 · 文件 {shortHash(pricingFile.sha256)}
                </Tag>
              ) : null}
            </Space>
            <Paragraph type="secondary">
              每个 model/meter 必须匹配唯一的已审批价目行，包含不可变 sourceRef、生效区间和审批信息。页面对规范化价目证据逐行计算 SHA-256；Billing 复验 hash、费率、币种、模型、meter、生效区间与审批字段，并将其写入 lineHash/fingerprint。
            </Paragraph>
            <IssuesPanel issues={pricingFile?.issues ?? []} />
          </div>

          <Divider orientation="left">汇率与理由</Divider>
          <div className="historical-loss-form-grid">
            <Form.Item label="汇率（如适用）" name="exchangeRate"><Input /></Form.Item>
            <Form.Item label="汇率来源" name="exchangeRateSource"><Input /></Form.Item>
            <Form.Item label="汇率源币种" name="exchangeRateSourceCurrency"><Input maxLength={3} placeholder="USD" /></Form.Item>
            <Form.Item label="汇率日期" name="exchangeRateAsOf"><DatePicker style={{ width: '100%' }} /></Form.Item>
          </div>
          <Form.Item label="准备理由 / 事件号" name="reason" rules={[{ required: true }, { max: 1000 }]}>
            <Input.TextArea maxLength={1000} rows={3} placeholder="例如：2026-07 GLM-5.2 供应商账单差额，由平台承担，FIN-..." />
          </Form.Item>
        </Form>

        {preview ? (
          <section className="historical-loss-preview">
            <Divider orientation="left">服务端预检结果</Divider>
            <Alert
              type={preview.status === 'READY' ? 'success' : 'error'}
              showIcon
              message={preview.status === 'READY' ? 'READY：可创建待审批批次' : 'BLOCKED：不得创建批次'}
              description={(
                <Text code copyable={preview.fingerprint ? { text: preview.fingerprint } : false}>
                  fingerprint: {preview.fingerprint ?? 'BLOCKED（未生成）'}
                </Text>
              )}
            />
            <TotalsPanel totals={preview.totals} currency={preview.currency} />
            <Alert
              type="success"
              showIcon
              message={`客户补扣 = ${preview.totals?.customerDeduction ?? '—'}`}
              description="创建批次没有资金影响；后续审批入账也不会修改已出账单或客户余额。"
            />
            <IssuesPanel issues={preview.issues ?? []} />
            <Table<HistoricalPlatformLossLineRow>
              rowKey={(row) => row.lineHash ?? String(row.lineNumber)}
              columns={lineColumns}
              dataSource={preview.lines}
              size="small"
              pagination={{ pageSize: 20 }}
              scroll={{ x: 1700 }}
            />
          </section>
        ) : null}
      </Drawer>

      <Drawer
        title="历史平台损失批次详情"
        width="min(1180px, 96vw)"
        open={Boolean(detail) || detailLoading}
        loading={detailLoading}
        onClose={() => setDetail(null)}
        extra={detail ? (
          <Space>
            <Button icon={<DownloadOutlined />} disabled={!canExport} onClick={() => void exportBatch(detail)}>导出</Button>
            <Button
              type="primary"
              disabled={!detailCanApprove}
              title={detailApprovalIssue ?? undefined}
              icon={<CheckCircleOutlined />}
              onClick={() => openApproval(detail)}
            >
              审批并入账
            </Button>
          </Space>
        ) : null}
      >
        {detail ? (
          <>
            <Alert
              type={makerConflict ? 'error' : detail.status === 'PREPARED' ? 'warning' : 'success'}
              showIcon
              icon={makerConflict ? <WarningOutlined /> : undefined}
              message={makerConflict
                ? 'Maker-checker：你是创建人，不能审批此批次'
                : detail.status === 'PREPARED'
                  ? '等待另一位 Finance / Super Admin 审批'
                  : '批次已形成永久平台损失事实'}
              description="审批入账的客户补扣恒为 0，已出账单与客户余额保持不变。"
            />
            <Descriptions bordered size="small" column={2} className="historical-loss-descriptions">
              <Descriptions.Item label="状态"><Tag color={statusColors[detail.status] ?? 'default'}>{detail.status}</Tag></Descriptions.Item>
              <Descriptions.Item label="revision">{detail.revision}</Descriptions.Item>
              <Descriptions.Item label="供应商">{detail.provider}</Descriptions.Item>
              <Descriptions.Item label="供应商账号">{detail.providerAccountRef}</Descriptions.Item>
              <Descriptions.Item label="地区">{detail.region}</Descriptions.Item>
              <Descriptions.Item label="账期">{detail.periodStart} → {detail.periodEnd}</Descriptions.Item>
              <Descriptions.Item label="币种">{detail.currency}</Descriptions.Item>
              <Descriptions.Item label="行数">{detail.itemCount}</Descriptions.Item>
              <Descriptions.Item label="准备理由" span={2}>{detail.reason || '—'}</Descriptions.Item>
              <Descriptions.Item label="汇率方向">
                {detail.exchangeRateDirection || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="汇率">
                {detail.exchangeRate ?? '—'}
              </Descriptions.Item>
              <Descriptions.Item label="来源文件" span={2}><Text copyable>{detail.sourceFileRef}</Text></Descriptions.Item>
              <Descriptions.Item label="文件 SHA-256" span={2}><Text code copyable>{detail.sourceFileSha256}</Text></Descriptions.Item>
              <Descriptions.Item label="批次指纹" span={2}><Text code copyable>{detail.fingerprint}</Text></Descriptions.Item>
              <Descriptions.Item label="创建人"><Text copyable>{detail.makerActorId}</Text></Descriptions.Item>
              <Descriptions.Item label="审批人">{detail.checkerActorId ? <Text copyable>{detail.checkerActorId}</Text> : '—'}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{formatTime(detail.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="入账时间">{formatTime(detail.postedAt)}</Descriptions.Item>
            </Descriptions>
            <TotalsPanel totals={detail.totals} currency={detail.currency} />
            <Alert
              type="success"
              showIcon
              message={`客户补扣 = ${detail.totals?.customerDeduction ?? '0'}`}
              description="平台损失与供应商成本修正单独记录；原客户 TokenUsage、余额流水和账单均不改写。"
            />
            <Divider orientation="left">明细</Divider>
            <Table<HistoricalPlatformLossLineRow>
              rowKey={(row) => row.id ?? row.lineHash ?? String(row.lineNumber)}
              columns={lineColumns}
              dataSource={detail.lines ?? []}
              size="small"
              pagination={{ pageSize: 20 }}
              scroll={{ x: 1700 }}
            />
            <Divider orientation="left">永久动作记录</Divider>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={detail.actions ?? []}
              columns={[
                { title: '动作', dataIndex: 'action', width: 180 },
                { title: '操作者', dataIndex: 'actorId', width: 220 },
                { title: 'revision', render: (_, row) => `${row.expectedRevision} → ${row.resultingRevision}`, width: 140 },
                { title: '原因', dataIndex: 'reason' },
                { title: '幂等键', dataIndex: 'idempotencyKey', render: (value) => <Text code copyable>{value}</Text> },
                { title: '时间', dataIndex: 'createdAt', render: formatTime, width: 180 },
              ]}
            />
          </>
        ) : null}
      </Drawer>

      <Modal
        title="二次确认：审批并入账平台损失"
        open={Boolean(approvalTarget)}
        okText="确认客户补扣为 0 并入账"
        okButtonProps={{ danger: true }}
        confirmLoading={approving}
        onCancel={() => setApprovalTarget(null)}
        onOk={() => void approveAndPost()}
      >
        <Alert
          type="warning"
          showIcon
          message="这是有财务影响的 maker-checker 动作"
          description="只新增平台损失和供应商成本修正事实；不会修改客户已出账单、客户余额、原 TokenUsage 或原结算回执。"
        />
        <Form form={approvalForm} layout="vertical" className="historical-loss-approval-form">
          <Form.Item label="审批理由 / 财务凭证号" name="reason" rules={[{ required: true }, { max: 1000 }]}>
            <Input.TextArea maxLength={1000} rows={3} />
          </Form.Item>
          <Form.Item
            name="confirmNoCustomerImpact"
            valuePropName="checked"
            rules={[{
              validator: (_, value) => value
                ? Promise.resolve()
                : Promise.reject(new Error('必须确认客户补扣为 0 且账单、余额不变')),
            }]}
          >
            <Checkbox>我已复核：客户补扣 = 0，已出账单和客户余额不变</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
