import { useState, useEffect, useCallback } from 'react';
import {
  Button,
  Input,
  Select,
  DatePicker,
  App,
  Descriptions,
  Space,
  Modal,
  Tabs,
  Upload,
  Form,
  Alert,
} from 'antd';
import {
  ReloadOutlined,
  DownloadOutlined,
  EyeOutlined,
  RedoOutlined,
  CheckOutlined,
  CloseOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import {
  PageHeader,
  FilterBar,
  DataTable,
  DetailDrawer,
  StableNumberInput,
  Tag,
  StatCard,
  StatCardGroup,
} from '../../components/common';
import type { TagVariant } from '../../components/common';
import { usePermission } from '../../hooks/usePermission';
import { formatCurrencyCents } from '../../utils/price';
import { exportInvoiceData } from './export';
import {
  invoiceApi,
  type InvoiceApplication,
  type InvoiceItem,
  type InvoiceDeployment,
  type InvoiceListParams,
  type InvoicePsaStatus,
  type InvoiceRepairPlan,
  type InvoiceStatus,
  type IssueManualInvoiceBody,
} from '../../api/v2/invoices';

const { Option } = Select;
const { RangePicker } = DatePicker;
const { TextArea } = Input;

type ReasonAction = 'reject' | 'void' | 'redOffset' | 'fail';
type InvoiceStatusTab = InvoiceStatus | 'ALL' | 'EXCEPTION';

const REASON_TITLE: Record<ReasonAction, string> = {
  reject: '驳回申请',
  void: '作废发票',
  redOffset: '红冲发票',
  fail: '标记开票失败',
};

const STATUS_TABS: Array<{ key: InvoiceStatusTab; label: string }> = [
  { key: 'PENDING_REVIEW', label: '待审核' },
  { key: 'APPROVED_ISSUING', label: '待开票' },
  { key: 'ISSUED', label: '已开票' },
  { key: 'EXCEPTION', label: '异常' },
  { key: 'ALL', label: '全部' },
];

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  PENDING_REVIEW: '待审核',
  APPROVED_ISSUING: '待开票',
  ISSUED: '已开票',
  REJECTED: '已驳回',
  CANCELLED: '已撤回',
  FAILED: '开票失败',
  VOIDED: '已作废',
  RED_OFFSET: '已红冲',
};

const STATUS_VARIANT: Record<InvoiceStatus, TagVariant> = {
  PENDING_REVIEW: 'warn',
  APPROVED_ISSUING: 'proc',
  ISSUED: 'success',
  REJECTED: 'error',
  CANCELLED: 'muted',
  FAILED: 'error',
  VOIDED: 'muted',
  RED_OFFSET: 'muted',
};

const PSA_STATUS_LABEL: Record<InvoicePsaStatus, string> = {
  NOT_SUBMITTED: '未提交',
  SUBMITTING: '提交中',
  SUBMITTED: '已提交',
  FAILED: '失败',
};

const PSA_STATUS_VARIANT: Record<InvoicePsaStatus, TagVariant> = {
  NOT_SUBMITTED: 'muted',
  SUBMITTING: 'proc',
  SUBMITTED: 'success',
  FAILED: 'error',
};

interface FilterState {
  status: InvoiceStatusTab;
  email: string;
  username: string;
  orderId: string;
  productName: string;
  applicationNo: string;
  range: [Dayjs, Dayjs] | null;
}

const EMPTY_FILTER: FilterState = {
  status: 'PENDING_REVIEW',
  email: '',
  username: '',
  orderId: '',
  productName: '',
  applicationNo: '',
  range: null,
};

function productNamesOf(inv: InvoiceApplication, item?: InvoiceItem | null): string {
  const source = item ? [item] : inv.items;
  const names = source
    .map((i) => i.productName || i.description)
    .filter(Boolean);
  return names.length ? Array.from(new Set(names)).join(', ') : '—';
}

type InvoiceListRow = InvoiceApplication & {
  rowKey: string;
  orderId: string;
  itemId: string | null;
  listItem: InvoiceItem | null;
};

function flattenInvoiceRows(apps: InvoiceApplication[]): InvoiceListRow[] {
  const rows: InvoiceListRow[] = [];
  for (const app of apps) {
    const items = app.items?.length ? app.items : [null];
    for (const item of items) {
      rows.push({
        ...app,
        rowKey: item ? `${app.id}:${item.id}` : app.id,
        orderId: item?.orderId || '—',
        itemId: item?.id ?? null,
        listItem: item,
        totalCents: item ? item.principalCents : app.totalCents,
        invoiceNumber: item?.invoiceNumber ?? app.invoiceNumber,
        pdfUrl: item?.pdfUrl ?? app.pdfUrl,
      });
    }
  }
  return rows;
}

function deploymentLabel(deployment: InvoiceDeployment | null) {
  if (!deployment) return '加载中';
  return deployment === 'domestic' ? '国内人工开票' : '国际人工开票';
}

function deploymentSubtitle(deployment: InvoiceDeployment | null, failed: boolean) {
  if (failed) return '无法识别当前部署的开票模式，请刷新后重试。';
  if (!deployment) return '正在识别当前部署的开票模式。';
  return deployment === 'domestic'
    ? '当前部署为国内版：申请审核通过后，由财务线下开票并上传票据给用户下载。'
    : '当前部署为国际版：申请审核通过后，由财务线下开票并上传票据给用户下载。';
}

function deploymentTagVariant(deployment: InvoiceDeployment | null): TagVariant {
  if (!deployment) return 'muted';
  return deployment === 'domestic' ? 'warn' : 'proc';
}

function statusParams(status: InvoiceStatusTab): Partial<InvoiceListParams> {
  if (status === 'ALL') return {};
  if (status === 'EXCEPTION') return { status: 'FAILED' };
  return { status };
}

function invoiceListParams(filter: FilterState): InvoiceListParams {
  return {
    ...statusParams(filter.status),
    ...(filter.email ? { email: filter.email.trim() } : {}),
    ...(filter.username ? { username: filter.username.trim() } : {}),
    ...(filter.orderId ? { orderId: filter.orderId.trim() } : {}),
    ...(filter.productName ? { productName: filter.productName.trim() } : {}),
    ...(filter.applicationNo ? { applicationNo: filter.applicationNo.trim() } : {}),
    ...(filter.range
      ? {
          issuedFrom: filter.range[0].startOf('day').toISOString(),
          issuedTo: filter.range[1].endOf('day').toISOString(),
        }
      : {}),
  };
}


function normalizeInvoiceNumber(value: string) {
  return value.trim().replace(/\s+/g, '');
}

function invoiceNumberTaken(
  value: string,
  apps: InvoiceApplication[],
  except: { applicationId: string; itemId: string | null },
) {
  const normalized = normalizeInvoiceNumber(value).toLowerCase();
  if (!normalized) return false;
  const same = (candidate?: string | null) =>
    typeof candidate === 'string'
    && normalizeInvoiceNumber(candidate).toLowerCase() === normalized;
  for (const app of apps) {
    if (same(app.invoiceNumber) && app.id !== except.applicationId) return true;
    for (const item of app.items ?? []) {
      if (same(item.invoiceNumber) && item.id !== except.itemId) return true;
    }
  }
  return false;
}

function canManualIssue(
  inv: InvoiceApplication,
  deployment: InvoiceDeployment | null,
  item?: InvoiceItem | null,
) {
  if (deployment === null || inv.status !== 'APPROVED_ISSUING') return false;
  if (item?.pdfUrl) return false;
  return true;
}

function psaStatusOf(inv: InvoiceApplication): InvoicePsaStatus {
  const value = inv.psaStatus;
  if (value === 'SUBMITTING' || value === 'SUBMITTED' || value === 'FAILED') return value;
  return 'NOT_SUBMITTED';
}

function psaStatusLabel(inv: InvoiceApplication) {
  return PSA_STATUS_LABEL[psaStatusOf(inv)];
}

function canRetryPsa(inv: InvoiceApplication) {
  if (inv.status !== 'APPROVED_ISSUING') return false;
  return ['NOT_SUBMITTED', 'FAILED', 'SUBMITTING'].includes(psaStatusOf(inv));
}

function shouldShowPsaStatus(inv: InvoiceApplication) {
  return inv.status === 'APPROVED_ISSUING' || psaStatusOf(inv) !== 'NOT_SUBMITTED' || Boolean(inv.psaFormNo);
}

function invoiceActionError(error: unknown, fallback: string) {
  const responseMessage = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
  if (typeof responseMessage === 'string' && responseMessage.trim()) return responseMessage;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

type ApproveModalState = {
  ids: string[];
  applicationNos: string[];
};

type SelectedInvoice = Pick<
  InvoiceApplication,
  'id' | 'status' | 'applicationNo' | 'pdfUrl' | 'psaAttachmentUrl'
>;

function snapshotInvoice(inv: InvoiceApplication): SelectedInvoice {
  return {
    id: inv.id,
    status: inv.status,
    applicationNo: inv.applicationNo,
    pdfUrl: inv.pdfUrl,
    psaAttachmentUrl: inv.psaAttachmentUrl,
  };
}

function canDownloadPdf(inv: Pick<InvoiceApplication, 'status' | 'pdfUrl'>) {
  return inv.status === 'ISSUED' && Boolean(inv.pdfUrl);
}

function canDownloadPsa(
  inv: Pick<InvoiceApplication, 'status' | 'psaAttachmentUrl'>,
  deployment: InvoiceDeployment | null,
) {
  if (inv.psaAttachmentUrl) return true;
  return deployment === 'international' && (inv.status === 'APPROVED_ISSUING' || inv.status === 'ISSUED');
}

function canDownloadInvoice(
  inv: Pick<InvoiceApplication, 'status' | 'pdfUrl' | 'psaAttachmentUrl'>,
  deployment: InvoiceDeployment | null,
) {
  return canDownloadPdf(inv) || canDownloadPsa(inv, deployment);
}

function approveModalCopy(modal: ApproveModalState) {
  const batch = modal.ids.length > 1;
  const nos = modal.applicationNos.filter(Boolean);
  const subject = batch
    ? `已选择 ${modal.ids.length} 张待审核申请`
    : `申请单 ${nos[0] || modal.ids[0]}`;
  return {
    title: batch ? '确认批量审核通过？' : '确认审核通过？',
    okText: batch ? '全部通过' : '通过',
    description: `${subject}，通过后会进入待开票，财务可上传线下开具的 PDF/OFD。`,
  };
}

function canReissueInternational(inv: InvoiceApplication, deployment: InvoiceDeployment | null) {
  return deployment === 'international' && inv.status === 'ISSUED';
}

function invoiceTitle(inv: InvoiceApplication) {
  return inv.profileSnapshot?.title || '—';
}

function formatDateTime(value?: string | null) {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—';
}

function formatDate(value?: string | null) {
  return value ? dayjs(value).format('YYYY-MM-DD') : '—';
}

function statusLabel(status: InvoiceStatus) {
  return STATUS_LABEL[status];
}

function eventText(event: NonNullable<InvoiceApplication['events']>[number]) {
  const from = event.fromStatus ? statusLabel(event.fromStatus) : '创建';
  const to = event.toStatus ? statusLabel(event.toStatus) : event.toStatus;
  return `${from} → ${to}`;
}

function uploadFileList(event: unknown): UploadFile[] {
  if (Array.isArray(event)) return event;
  const fileList = (event as { fileList?: UploadFile[] } | undefined)?.fileList;
  return fileList ?? [];
}

function originFile(file: UploadFile | undefined): File | undefined {
  return file?.originFileObj as File | undefined;
}

function reissueActionLabel(action: InvoiceRepairPlan['action']) {
  if (action === 'red_offset_and_reissue') return '红冲并新建申请';
  if (action === 'update_in_place') return '原地修正';
  if (action === 'none') return '无需修复';
  return '跳过';
}

export default function InvoicesPage() {
  // antd v5：静态 message 在根 <App> 下不渲染，重试 PSA 失败会看起来像没反应。
  const { message } = App.useApp();
  const [data, setData] = useState<InvoiceApplication[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [deployment, setDeployment] = useState<InvoiceDeployment | null>(null);
  const [deploymentFailed, setDeploymentFailed] = useState(false);
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTER);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [selectedMap, setSelectedMap] = useState<Record<string, SelectedInvoice>>({});
  const [detail, setDetail] = useState<InvoiceApplication | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const canManage = usePermission('admin.page.invoices.manage');
  const [acting, setActing] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [retryingPsaId, setRetryingPsaId] = useState<string | null>(null);
  const [downloadingPsaId, setDownloadingPsaId] = useState<string | null>(null);
  const [approveModal, setApproveModal] = useState<ApproveModalState | null>(null);
  const [retryModal, setRetryModal] = useState<InvoiceApplication | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [reasonModal, setReasonModal] = useState<{
    kind: ReasonAction;
    inv: InvoiceApplication;
  } | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [issueModal, setIssueModal] = useState<{ inv: InvoiceApplication; itemId: string | null } | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [issueForm] = Form.useForm<{
    invoiceNumber: string;
    issuingEntity: string;
    issueDate: Dayjs;
    taxAmountCents?: number;
    pdfFile?: UploadFile[];
    ofdFile?: UploadFile[];
  }>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { ...invoiceListParams(applied), page, pageSize: 20 };
      const res = await invoiceApi.list(params);
      setData(res.items);
      setTotal(res.total);
    } catch (err) {
      message.error((err as Error)?.message || '加载发票失败');
    } finally {
      setLoading(false);
    }
  }, [page, applied]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void invoiceApi.getDeployment()
      .then((res) => {
        setDeployment(res.deployment);
        setDeploymentFailed(false);
      })
      .catch(() => {
        setDeployment(null);
        setDeploymentFailed(true);
      });
  }, []);

  function clearSelection() {
    setSelectedKeys([]);
    setSelectedMap({});
  }

  function applyFilter() {
    setPage(1);
    setApplied(filter);
    clearSelection();
  }
  function applyStatusTab(status: InvoiceStatusTab) {
    const next = { ...filter, status };
    setFilter(next);
    setApplied(next);
    clearSelection();
    setPage(1);
  }
  function resetFilter() {
    const next = { ...EMPTY_FILTER, status: applied.status };
    setFilter(next);
    setApplied(next);
    clearSelection();
    setPage(1);
  }

  const exportLabel = STATUS_TABS.find((tab) => tab.key === applied.status)?.label
    ?? STATUS_LABEL[applied.status as InvoiceStatus];

  async function exportCurrentTab() {
    if (exporting) return;
    setExporting(true);
    try {
      const count = await exportInvoiceData(invoiceListParams(applied), exportLabel, STATUS_LABEL);
      if (count === 0) message.info(`「${exportLabel}」当前筛选条件下暂无可导出的数据`);
      else message.success(`已导出「${exportLabel}」${count} 条数据`);
    } catch (err) {
      message.error(invoiceActionError(err, '导出发票数据失败，请重试'));
    } finally {
      setExporting(false);
    }
  }

  async function openDetail(inv: InvoiceApplication) {
    setDetail(inv);
    try {
      const full = await invoiceApi.getDetail(inv.id);
      setDetail(full);
    } catch {
      // 列表数据仍可用于基础查看，详情刷新失败不打断当前操作。
    }
  }

  function selectedInvoices() {
    return selectedKeys
      .map((id) => selectedMap[id] ?? data.find((item) => item.id === id))
      .filter((item): item is SelectedInvoice => Boolean(item));
  }

  function pendingSelectedIds() {
    const applicationIds = selectedInvoices()
      .filter((item) => item.status === 'PENDING_REVIEW')
      .map((item) => item.id);
    if (applicationIds.length > 0) return [...new Set(applicationIds)];
    if (applied.status === 'PENDING_REVIEW') {
      return [...new Set(selectedKeys.map((key) => key.split(':')[0]).filter(Boolean))];
    }
    return [];
  }

  async function downloadIds(ids: string[]) {
    if (ids.length === 0) {
      message.warning('请选择要下载的发票');
      return;
    }
    setDownloading(true);
    try {
      await invoiceApi.downloadZip(ids);
      message.success(ids.length === 1 ? '已下载发票 PDF' : `已打包下载 ${ids.length} 张发票 PDF`);
    } catch (err) {
      message.error((err as Error)?.message || '下载失败');
    } finally {
      setDownloading(false);
    }
  }

  async function downloadSelected() {
    if (selectedKeys.length === 0) {
      message.warning('请勾选要下载的发票');
      return;
    }
    const selected = selectedInvoices();
    const pdfIds = [...new Set(selected.filter((item) => canDownloadPdf(item)).map((item) => item.id))];
    const psaSeen = new Set<string>();
    const psaItems = selected.filter((item) => {
      if (canDownloadPdf(item) || !canDownloadPsa(item, deployment) || psaSeen.has(item.id)) return false;
      psaSeen.add(item.id);
      return true;
    });
    if (pdfIds.length === 0 && psaItems.length === 0) {
      message.warning(
        applied.status === 'APPROVED_ISSUING' && deployment !== 'international'
          ? '待开票国内版还没有可下载票据，需财务上传后再下载'
          : '选中项暂无可下载文件',
      );
      return;
    }
    setDownloading(true);
    try {
      const parts: string[] = [];
      if (pdfIds.length > 0) {
        await invoiceApi.downloadZip(pdfIds);
        parts.push(`${pdfIds.length} 张 PDF`);
      }
      let psaOk = 0;
      let psaFail = 0;
      for (const item of psaItems) {
        try {
          await invoiceApi.downloadPsaAttachment(item.id);
          psaOk += 1;
        } catch {
          psaFail += 1;
        }
      }
      if (psaOk) parts.push(`${psaOk} 份 Invoice`);
      if (parts.length) message.success(`已下载${parts.join('、')}`);
      if (psaFail) message.warning(`${psaFail} 份 Invoice 下载失败`);
    } catch (err) {
      message.error((err as Error)?.message || '下载失败');
    } finally {
      setDownloading(false);
    }
  }

  async function confirmInternationalReissue(inv: InvoiceApplication) {
    let plan: InvoiceRepairPlan | undefined;
    try {
      const preview = await invoiceApi.reissue(inv.id, true);
      plan = preview.items.find((item) => item.applicationId === inv.id);
    } catch (err) {
      message.error((err as Error)?.message || '预览红冲并新建申请失败');
      return;
    }

    if (!plan) {
      message.warning('未找到可预览的修复计划');
      return;
    }
    if (plan.action !== 'red_offset_and_reissue') {
      Modal.info({
        title: '无需红冲并新建申请',
        content: (
          <Alert
            type={plan.action === 'none' ? 'success' : 'warning'}
            showIcon
            message={reissueActionLabel(plan.action)}
            description={plan.reason || '当前发票金额已与订单实付金额一致。'}
          />
        ),
      });
      return;
    }

    Modal.confirm({
      title: '确认红冲并新建申请？',
      okText: '红冲并新建申请',
      cancelText: '取消',
      okButtonProps: { danger: true },
      width: 640,
      content: (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="warning"
            showIcon
            message="该操作不可逆"
            description="系统会红冲原票，并按订单实付金额新建一笔待审核申请。财务审核通过后需线下开票并上传票据，原票号保留在红冲记录中。"
          />
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="原票号">
              {plan.invoiceNumber || inv.invoiceNumber || '—'}
            </Descriptions.Item>
            <Descriptions.Item label="原金额">
              {formatCurrencyCents(plan.previousTotalCents, inv.currency)}
            </Descriptions.Item>
            <Descriptions.Item label="新申请金额">
              {formatCurrencyCents(plan.expectedTotalCents, inv.currency)}
            </Descriptions.Item>
            <Descriptions.Item label="关联订单">
              {plan.orderIds.length ? plan.orderIds.join(', ') : '—'}
            </Descriptions.Item>
          </Descriptions>
        </Space>
      ),
      onOk: async () => {
        await invoiceApi.reissue(inv.id, false);
        message.success('已红冲原票并新建待审核申请');
        await syncUpdatedDetail(inv.id);
        await load();
      },
    });
  }

  function mergeInvoice(
    current: InvoiceApplication,
    updated: InvoiceApplication,
  ): InvoiceApplication {
    return {
      ...current,
      ...updated,
      events: updated.events ?? current.events,
      user: updated.user ?? current.user,
    };
  }

  function syncUpdatedInvoice(updated: InvoiceApplication) {
    setData((items) =>
      items.map((item) => (item.id === updated.id ? mergeInvoice(item, updated) : item)),
    );
    setDetail((current) =>
      current?.id === updated.id ? mergeInvoice(current, updated) : current,
    );
  }

  async function syncUpdatedDetail(applicationId: string, fallback?: InvoiceApplication) {
    try {
      const full = await invoiceApi.getDetail(applicationId);
      syncUpdatedInvoice(full);
    } catch {
      if (fallback) syncUpdatedInvoice(fallback);
    }
  }

  async function downloadPsaAttachment(inv: InvoiceApplication) {
    if (downloadingPsaId) return;
    setDownloadingPsaId(inv.id);
    try {
      await invoiceApi.downloadPsaAttachment(inv.id);
      await syncUpdatedDetail(inv.id);
      message.success('已下载 Invoice');
    } catch (err) {
      message.error(invoiceActionError(err, '下载 Invoice 失败'));
    } finally {
      setDownloadingPsaId(null);
    }
  }

  function approveApplication(inv: InvoiceApplication) {
    if (approvingId) return;
    setApproveModal({ ids: [inv.id], applicationNos: [inv.applicationNo] });
  }

  function approveSelected() {
    if (approvingId) return;
    const ids = pendingSelectedIds();
    if (ids.length === 0) {
      message.warning('请勾选待审核的申请');
      return;
    }
    const applicationNos = selectedInvoices()
      .filter((item) => ids.includes(item.id))
      .map((item) => item.applicationNo);
    setApproveModal({ ids, applicationNos });
  }

  async function submitApproveApplication() {
    if (!approveModal || approvingId) return;
    const { ids } = approveModal;
    const batch = ids.length > 1;
    setApprovingId(batch ? 'batch' : ids[0]);
    try {
      const result = await invoiceApi.approveMany(ids);
      if (result.failed.length === 0) {
        message.success(ids.length === 1 ? '申请已通过' : `已通过 ${result.succeeded.length} 张申请`);
      } else if (result.succeeded.length === 0) {
        message.error(
          result.failed.length === 1
            ? (result.failed[0]?.message || '审核通过失败')
            : `全部失败（${result.failed.length} 张）`,
        );
      } else {
        message.warning(`已通过 ${result.succeeded.length} 张，失败 ${result.failed.length} 张`);
      }
      setApproveModal(null);
      setSelectedKeys((keys) => keys.filter((key) => !result.succeeded.includes(key)));
      setSelectedMap((current) => {
        const next = { ...current };
        for (const id of result.succeeded) delete next[id];
        return next;
      });
      if (detail && result.succeeded.includes(detail.id)) {
        await syncUpdatedDetail(detail.id);
      }
      await load();
    } catch (err) {
      message.error((err as Error)?.message || '审核通过失败');
    } finally {
      setApprovingId(null);
    }
  }

  function retryPsaSubmission(inv: InvoiceApplication) {
    setRetryError(null);
    setRetryModal(inv);
  }

  async function submitRetryPsa() {
    if (!retryModal || retryingPsaId) return;
    const inv = retryModal;
    setRetryError(null);
    setRetryingPsaId(inv.id);
    try {
      const updated = await invoiceApi.retryPsa(inv.id);
      syncUpdatedInvoice(updated);
      await syncUpdatedDetail(inv.id, updated);
      if (updated.psaStatus === 'SUBMITTED') {
        message.success(`PSA 已提交${updated.psaFormNo ? `（${updated.psaFormNo}）` : ''}`);
      } else if (updated.psaStatus === 'FAILED') {
        throw new Error(updated.psaLastError || 'PSA 提交失败');
      } else {
        message.success('已发起 PSA 提交');
      }
      setRetryModal(null);
      setRetryError(null);
      await load();
    } catch (err) {
      const failed = invoiceActionError(err, 'PSA 重试失败');
      setRetryError(failed);
      message.error(failed);
      throw err instanceof Error ? err : new Error(failed);
    } finally {
      setRetryingPsaId(null);
    }
  }

  function rejectApplication(inv: InvoiceApplication) {
    setReasonText('');
    setReasonModal({ kind: 'reject', inv });
  }

  function openIssueModal(inv: InvoiceApplication, itemId?: string | null) {
    setIssueModal({ inv, itemId: itemId ?? null });
    const item = inv.items.find((entry) => entry.id === itemId);
    issueForm.setFieldsValue({
      issuingEntity: item?.issuingEntity || inv.issuingEntity || (deployment === 'international' ? '102ISSHK' : '国内主体'),
      issueDate: dayjs(),
      taxAmountCents: inv.taxAmountCents ?? 0,
      pdfFile: [],
      ofdFile: [],
    });
  }

  async function submitManualIssue() {
    if (!issueModal) return;
    const values = await issueForm.validateFields();
    const pdf = originFile(values.pdfFile?.[0]);
    const ofd = originFile(values.ofdFile?.[0]);
    if (!pdf) {
      message.warning('请上传发票 PDF');
      return;
    }
    setIssuing(true);
    try {
      const body: IssueManualInvoiceBody = {
        invoiceNumber: values.invoiceNumber.trim(),
        issuingEntity: values.issuingEntity.trim(),
        issueDate: values.issueDate.toISOString(),
        taxAmountCents: values.taxAmountCents ?? 0,
        pdfFile: pdf,
        ofdFile: ofd ?? null,
      };
      const updated = await invoiceApi.issueManual(issueModal.inv.id, body, issueModal.itemId);
      syncUpdatedInvoice(updated);
      await syncUpdatedDetail(issueModal.inv.id, updated);
      message.success(updated.status === 'ISSUED' ? '已发布发票，用户侧可下载' : '该订单发票已上传，待其余订单上传完成后用户可下载');
      setIssueModal(null);
      issueForm.resetFields();
      await load();
    } catch (err) {
      message.error(invoiceActionError(err, '发布发票失败'));
    } finally {
      setIssuing(false);
    }
  }

  // 需要原因的动作（作废 / 红冲 / 标记失败）。
  async function submitReasonAction() {
    if (!reasonModal) return;
    const reason = reasonText.trim();
    if (!reason) {
      message.warning('请填写原因');
      return;
    }
    setActing(true);
    try {
      const { kind, inv } = reasonModal;
      if (kind === 'reject') await invoiceApi.reject(inv.id, reason);
      else if (kind === 'void') await invoiceApi.void(inv.id, reason);
      else if (kind === 'redOffset') await invoiceApi.redOffset(inv.id, reason);
      else await invoiceApi.fail(inv.id, reason);
      message.success('操作成功');
      setReasonModal(null);
      setReasonText('');
      await load();
    } catch (err) {
      message.error((err as Error)?.message || '操作失败');
    } finally {
      setActing(false);
    }
  }

  const pendingCount = data.filter((item) => item.status === 'PENDING_REVIEW').length;
  const issuingCount = data.filter((item) => item.status === 'APPROVED_ISSUING').length;
  const issuedCount = data.filter((item) => item.status === 'ISSUED').length;
  const exceptionCount = data.filter((item) => item.status === 'FAILED').length;
  const pendingSelectedCount = pendingSelectedIds().length;
  const showBatchApprove = canManage && deployment !== null && (applied.status === 'PENDING_REVIEW' || applied.status === 'ALL');

  const columns = [
    ...(applied.status === 'ISSUED' ? [{
      title: '发票号',
      dataIndex: 'invoiceNumber',
      key: 'invoiceNumber',
      render: (value: string | null) => value || '—',
    }] : []),
    {
      title: '申请号',
      dataIndex: 'applicationNo',
      key: 'applicationNo',
      render: (v: string | null) => v || '—',
    },
    {
      title: '订单号',
      dataIndex: 'orderId',
      key: 'orderId',
      render: (value: string) => value || '—',
    },
    {
      title: '用户',
      key: 'user',
      render: (_: unknown, r: InvoiceApplication) =>
        r.user?.email || r.user?.nickname || r.userId,
    },
    {
      title: '产品',
      key: 'product',
      render: (_: unknown, r: InvoiceListRow) => productNamesOf(r, r.listItem),
    },
    {
      title: '抬头',
      key: 'profile',
      render: (_: unknown, r: InvoiceApplication) => invoiceTitle(r),
    },
    {
      title: '金额',
      key: 'amount',
      align: 'right' as const,
      render: (_: unknown, r: InvoiceApplication) =>
        formatCurrencyCents(r.totalCents, r.currency),
    },
    {
      title: '开票日',
      dataIndex: 'issueDate',
      key: 'issueDate',
      render: (v: string | null) => (v ? dayjs(v).format('YYYY-MM-DD') : '—'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (_: InvoiceStatus, r: InvoiceApplication) => (
        <Space size={4} wrap>
          <Tag variant={STATUS_VARIANT[r.status]}>{statusLabel(r.status)}</Tag>
          {shouldShowPsaStatus(r) ? (
            <Tag variant={PSA_STATUS_VARIANT[psaStatusOf(r)]}>PSA {psaStatusLabel(r)}</Tag>
          ) : null}
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      align: 'right' as const,
      render: (_: unknown, r: InvoiceListRow) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              void openDetail(r);
            }}
          >
            详情
          </Button>
          <Button
            type="link"
            size="small"
            icon={<DownloadOutlined />}
            loading={downloadingPsaId === r.id}
            disabled={!canDownloadInvoice(r, deployment)}
            onClick={(e) => {
              e.stopPropagation();
              if (canDownloadPdf(r)) void downloadIds([r.id]);
              else void downloadPsaAttachment(r);
            }}
          >
            下载
          </Button>
          {canManage && deployment !== null && r.status === 'PENDING_REVIEW' && (
            <>
              <Button
                type="link"
                size="small"
                icon={<CheckOutlined />}
                loading={approvingId === r.id}
                disabled={approvingId !== null}
                onClick={(e) => {
                  e.stopPropagation();
                  approveApplication(r);
                }}
              >
                通过
              </Button>
              <Button
                type="link"
                size="small"
                danger
                icon={<CloseOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  rejectApplication(r);
                }}
              >
                驳回
              </Button>
            </>
          )}
          {canManage && canReissueInternational(r, deployment) ? (
            <Button
              type="link"
              size="small"
              danger
              icon={<RedoOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                void confirmInternationalReissue(r);
              }}
            >
              红冲并新建申请
            </Button>
          ) : null}
          {canManage && r.status === 'ISSUED' && (
            <>
              <Button
                type="link"
                size="small"
                danger
                onClick={(e) => {
                  e.stopPropagation();
                  setReasonText('');
                  setReasonModal({ kind: 'void', inv: r });
                }}
              >
                作废
              </Button>
              <Button
                type="link"
                size="small"
                danger
                onClick={(e) => {
                  e.stopPropagation();
                  setReasonText('');
                  setReasonModal({ kind: 'redOffset', inv: r });
                }}
              >
                红冲
              </Button>
            </>
          )}
          {canManage && r.status === 'APPROVED_ISSUING' && (
            <>
              {canRetryPsa(r) ? (
                <Button
                  type="link"
                  size="small"
                  icon={<RedoOutlined />}
                  loading={retryingPsaId === r.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    retryPsaSubmission(r);
                  }}
                >
                  重试 PSA
                </Button>
              ) : null}
              {canManualIssue(r, deployment, r.listItem) ? (
                <Button
                  type="link"
                  size="small"
                  icon={<UploadOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    openIssueModal(r, r.itemId);
                  }}
                >
                  上传票据
                </Button>
              ) : null}
              {deployment !== null ? (
                <Button
                  type="link"
                  size="small"
                  danger
                  onClick={(e) => {
                    e.stopPropagation();
                    setReasonText('');
                    setReasonModal({ kind: 'fail', inv: r });
                  }}
                >
                  标记失败
                </Button>
              ) : null}
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="发票管理"
        subtitle={deploymentSubtitle(deployment, deploymentFailed)}
        actions={[
          <Tag key="deployment" variant={deploymentTagVariant(deployment)}>
            {deploymentFailed ? '识别失败' : deploymentLabel(deployment)}
          </Tag>,
          <Button key="refresh" icon={<ReloadOutlined />} onClick={() => void load()}>
            刷新
          </Button>,
        ]}
      />

      <StatCardGroup columns={4}>
        <StatCard label="当前页待审核" value={pendingCount} variant="warning" />
        <StatCard label="当前页待开票" value={issuingCount} />
        <StatCard label="当前页已开票" value={issuedCount} variant="success" />
        <StatCard label="当前页异常" value={exceptionCount} variant="error" />
      </StatCardGroup>

      <Tabs
        activeKey={STATUS_TABS.some((tab) => tab.key === applied.status) ? applied.status : 'ALL'}
        items={STATUS_TABS.map((item) => ({
          key: item.key,
          label: item.label,
        }))}
        onChange={(key) => applyStatusTab(key as InvoiceStatusTab)}
      />

      <FilterBar
        filters={[
          <Input
            key="email"
            placeholder="邮箱"
            allowClear
            style={{ width: 160 }}
            value={filter.email}
            onChange={(e) => setFilter((f) => ({ ...f, email: e.target.value }))}
            onPressEnter={applyFilter}
          />,
          <Input
            key="username"
            placeholder="用户名"
            allowClear
            style={{ width: 140 }}
            value={filter.username}
            onChange={(e) => setFilter((f) => ({ ...f, username: e.target.value }))}
            onPressEnter={applyFilter}
          />,
          <Input
            key="orderId"
            placeholder="订单号"
            allowClear
            style={{ width: 180 }}
            value={filter.orderId}
            onChange={(e) => setFilter((f) => ({ ...f, orderId: e.target.value }))}
            onPressEnter={applyFilter}
          />,
          <Input
            key="productName"
            placeholder="产品/套餐"
            allowClear
            style={{ width: 140 }}
            value={filter.productName}
            onChange={(e) => setFilter((f) => ({ ...f, productName: e.target.value }))}
            onPressEnter={applyFilter}
          />,
          <Input
            key="applicationNo"
            placeholder="申请号"
            allowClear
            style={{ width: 170 }}
            value={filter.applicationNo}
            onChange={(e) =>
              setFilter((f) => ({ ...f, applicationNo: e.target.value }))
            }
            onPressEnter={applyFilter}
          />,
          <Select
            key="status"
            style={{ width: 130 }}
            value={filter.status}
            onChange={(v) => setFilter((f) => ({ ...f, status: v }))}
          >
            <Option value="ALL">全部状态</Option>
            <Option value="EXCEPTION">异常</Option>
            {(Object.keys(STATUS_LABEL) as InvoiceStatus[]).map((s) => (
              <Option key={s} value={s}>
                {STATUS_LABEL[s]}
              </Option>
            ))}
          </Select>,
          <RangePicker
            key="range"
            value={filter.range}
            onChange={(v) =>
              setFilter((f) => ({ ...f, range: (v as [Dayjs, Dayjs]) ?? null }))
            }
          />,
          <Button key="apply" type="primary" onClick={applyFilter}>
            查询
          </Button>,
          <Button key="reset" onClick={resetFilter}>
            重置
          </Button>,
        ]}
        rightActions={
          <Space wrap>
            <Button
              icon={<DownloadOutlined />}
              loading={exporting}
              disabled={loading}
              aria-label={`导出${exportLabel}数据`}
              title="导出当前标签已应用筛选条件下的全部数据（CSV）"
              onClick={() => void exportCurrentTab()}
            >
              导出{exportLabel}数据
            </Button>
            {showBatchApprove ? (
              <Button
                type="primary"
                icon={<CheckOutlined />}
                loading={approvingId === 'batch'}
                disabled={pendingSelectedCount === 0 || approvingId !== null}
                aria-label={`批量通过（${pendingSelectedCount}）`}
                onClick={approveSelected}
              >
                批量通过（{pendingSelectedCount}）
              </Button>
            ) : null}
            <Button
              type={showBatchApprove ? 'default' : 'primary'}
              icon={<DownloadOutlined />}
              loading={downloading}
              disabled={selectedKeys.length === 0}
              aria-label={`下载选中（${selectedKeys.length}）`}
              title="已开票下载 PDF；待开票国际版下载 Invoice"
              onClick={() => void downloadSelected()}
            >
              下载选中（{selectedKeys.length}）
            </Button>
          </Space>
        }
      />

      <DataTable<InvoiceListRow>
        columns={columns}
        dataSource={flattenInvoiceRows(data)}
        rowKey="rowKey"
        loading={loading}
        scroll={{ x: 1280 }}
        size="middle"
        onRowClick={(record) => void openDetail(record)}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          preserveSelectedRowKeys: true,
          onChange: (keys, rows) => {
            const nextKeys = keys as string[];
            setSelectedKeys(nextKeys);
            setSelectedMap((prev) => {
              const next: Record<string, SelectedInvoice> = {};
              const rowByKey = new Map(rows.map((row) => [row.rowKey, row]));
              for (const key of nextKeys) {
                const row = rowByKey.get(key);
                if (row) next[key] = snapshotInvoice(row);
                else if (prev[key]) next[key] = prev[key];
              }
              return next;
            });
          },
        }}
        listPagination={{
          current: page,
          total,
          pageSize: 20,
          onChange: (p) => setPage(p),
        }}
      />

      <DetailDrawer
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.invoiceNumber || detail?.applicationNo || '发票详情'}
        subtitle={detail ? statusLabel(detail.status) : undefined}
        actions={
          detail ? (
            <Space>
              {canManage && detail.status === 'PENDING_REVIEW' && deployment !== null ? (
                <>
                  <Button
                    icon={<CheckOutlined />}
                    loading={approvingId === detail.id}
                    disabled={approvingId !== null}
                    onClick={() => approveApplication(detail)}
                  >
                    通过
                  </Button>
                  <Button danger icon={<CloseOutlined />} onClick={() => rejectApplication(detail)}>
                    驳回
                  </Button>
                </>
              ) : null}
              {canManage && canRetryPsa(detail) ? (
                <Button
                  icon={<RedoOutlined />}
                  loading={retryingPsaId === detail.id}
                  onClick={() => retryPsaSubmission(detail)}
                >
                  重试 PSA
                </Button>
              ) : null}
              {canManage && canManualIssue(detail, deployment) ? (
                <Button type="primary" icon={<UploadOutlined />} onClick={() => openIssueModal(detail, detail.items.find((item) => !item.pdfUrl)?.id ?? detail.items[0]?.id ?? null)}>
                  上传票据
                </Button>
              ) : null}
              {canManage && canReissueInternational(detail, deployment) ? (
                <Button
                  danger
                  icon={<RedoOutlined />}
                  onClick={() => void confirmInternationalReissue(detail)}
                >
                  红冲并新建申请
                </Button>
              ) : null}
              {detail.status === 'ISSUED' && detail.pdfUrl && !detail.pdfUrl.startsWith('/storage/invoices/') ? (
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  onClick={() => void downloadIds([detail.id])}
                >
                  下载 PDF
                </Button>
              ) : null}
            </Space>
          ) : undefined
        }
        tabs={[
          {
            key: 'info',
            label: '申请信息',
            content: detail ? (
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="申请单号">
                  {detail.applicationNo}
                </Descriptions.Item>
                <Descriptions.Item label="开票模式">
                  <Tag variant={deploymentTagVariant(deployment)}>
                    {deploymentFailed ? '识别失败' : deploymentLabel(deployment)}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="发票号">
                  {detail.invoiceNumber || '—'}
                </Descriptions.Item>
                <Descriptions.Item label="PSA提交">
                  <Space size={8} wrap>
                    <Tag variant={PSA_STATUS_VARIANT[psaStatusOf(detail)]}>{psaStatusLabel(detail)}</Tag>
                    {detail.psaFormNo ? <span>BM {detail.psaFormNo}</span> : null}
                  </Space>
                </Descriptions.Item>
                <Descriptions.Item label="PSA提交时间">
                  {formatDateTime(detail.psaSubmittedAt)}
                </Descriptions.Item>
                <Descriptions.Item label="PSA最近尝试">
                  {formatDateTime(detail.psaLastAttemptAt)}
                  {detail.psaAttemptCount ? `（第 ${detail.psaAttemptCount} 次）` : ''}
                </Descriptions.Item>
                {detail.psaLastError ? (
                  <Descriptions.Item label="PSA错误">
                    {detail.psaLastError}
                  </Descriptions.Item>
                ) : null}
                {detail.psaAttachmentUrl || deployment === 'international' ? (
                  <Descriptions.Item label="Invoice 文件">
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <span>{detail.psaAttachmentUrl || '尚未生成'}</span>
                      <Button
                        type="link"
                        size="small"
                        icon={<EyeOutlined />}
                        loading={downloadingPsaId === detail.id}
                        style={{ padding: 0, height: 'auto' }}
                        onClick={() => void downloadPsaAttachment(detail)}
                      >
                        查看 Invoice
                      </Button>
                    </Space>
                  </Descriptions.Item>
                ) : null}
                <Descriptions.Item label="用户">
                  {detail.user?.email || detail.user?.nickname || detail.userId}
                </Descriptions.Item>
                <Descriptions.Item label="租户">
                  {detail.tenantId || '—'}
                </Descriptions.Item>
                <Descriptions.Item label="金额">
                  {formatCurrencyCents(detail.totalCents, detail.currency)}
                </Descriptions.Item>
                <Descriptions.Item label="税额">
                  {formatCurrencyCents(detail.taxAmountCents ?? 0, detail.currency)}
                </Descriptions.Item>
                <Descriptions.Item label="开票日">
                  {formatDate(detail.issueDate)}
                </Descriptions.Item>
                {deployment === 'international' ? (
                  <Descriptions.Item label="到期日">
                    {formatDate(detail.dueDate)}
                  </Descriptions.Item>
                ) : null}
                <Descriptions.Item label="开票主体">
                  {detail.issuingEntity || '—'}
                </Descriptions.Item>
                <Descriptions.Item label="申请时间">
                  {formatDateTime(detail.createdAt)}
                </Descriptions.Item>
              </Descriptions>
            ) : null,
          },
          {
            key: 'profile',
            label: '发票抬头',
            content: detail ? (
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="抬头名称">
                  {detail.profileSnapshot?.title || '—'}
                </Descriptions.Item>
                <Descriptions.Item label="发票类型">
                  {detail.profileSnapshot?.invoiceType || '—'}
                </Descriptions.Item>
                <Descriptions.Item label="抬头类型">
                  {detail.profileSnapshot?.kind || '—'}
                </Descriptions.Item>
                <Descriptions.Item label="纳税人识别号">
                  {detail.profileSnapshot?.taxNo || '—'}
                </Descriptions.Item>
                <Descriptions.Item label="开户银行">
                  {detail.profileSnapshot?.bankName || '—'}
                </Descriptions.Item>
                <Descriptions.Item label="银行账号">
                  {detail.profileSnapshot?.bankAccount || '—'}
                </Descriptions.Item>
                <Descriptions.Item label="注册地址">
                  {detail.profileSnapshot?.registeredAddress || '—'}
                </Descriptions.Item>
                <Descriptions.Item label="注册电话">
                  {detail.profileSnapshot?.registeredPhone || '—'}
                </Descriptions.Item>
                <Descriptions.Item label="接收邮箱">
                  {detail.profileSnapshot?.recipientEmail || '—'}
                </Descriptions.Item>
                <Descriptions.Item label="接收人">
                  {detail.profileSnapshot?.recipientName || '—'}
                </Descriptions.Item>
                <Descriptions.Item label="接收电话">
                  {detail.profileSnapshot?.recipientPhone || '—'}
                </Descriptions.Item>
                <Descriptions.Item label="收件地址">
                  {detail.profileSnapshot?.recipientAddress || '—'}
                </Descriptions.Item>
              </Descriptions>
            ) : null,
          },
          {
            key: 'items',
            label: '明细',
            content: detail ? (
              <Descriptions column={1} size="small" bordered>
                {detail.items.map((it) => (
                  <Descriptions.Item
                    key={it.id}
                    label={it.productName || it.description}
                  >
                    <Space direction="vertical" size={2}>
                      <span>{it.orderId} · {formatCurrencyCents(it.principalCents, detail.currency)}</span>
                      <span>
                        服务期：{formatDate(it.serviceStart)} 至 {formatDate(it.serviceEnd)}
                        {it.poNumber ? ` · PO ${it.poNumber}` : ''}
                      </span>
                    </Space>
                  </Descriptions.Item>
                ))}
              </Descriptions>
            ) : null,
          },
          {
            key: 'events',
            label: '流转日志',
            content: detail ? (
              <Descriptions column={1} size="small" bordered>
                {(detail.events ?? []).length === 0 ? (
                  <Descriptions.Item label="暂无日志">—</Descriptions.Item>
                ) : (
                  (detail.events ?? []).map((event) => (
                    <Descriptions.Item key={event.id} label={formatDateTime(event.occurredAt)}>
                      <Space direction="vertical" size={2}>
                        <span>{eventText(event)}</span>
                        <span>
                          操作人：{event.actorId || event.actorType || '—'}
                          {event.reason ? ` · ${event.reason}` : ''}
                        </span>
                      </Space>
                    </Descriptions.Item>
                  ))
                )}
              </Descriptions>
            ) : null,
          },
        ]}
      />

      <Modal
        open={!!approveModal}
        title={approveModal ? approveModalCopy(approveModal).title : '确认审核通过？'}
        zIndex={1100}
        onCancel={() => {
          if (approvingId) return;
          setApproveModal(null);
        }}
        onOk={() => void submitApproveApplication()}
        confirmLoading={!!approveModal && approvingId !== null}
        okText={approveModal ? approveModalCopy(approveModal).okText : '通过'}
        cancelText="取消"
        destroyOnClose
      >
        {approveModal ? (
          <Alert
            type="info"
            showIcon
            message={deploymentLabel(deployment)}
            description={approveModalCopy(approveModal).description}
          />
        ) : null}
      </Modal>

      <Modal
        open={!!retryModal}
        title="重试 PSA 提交？"
        zIndex={2000}
        getContainer={() => document.body}
        onCancel={() => {
          if (retryingPsaId) return;
          setRetryModal(null);
          setRetryError(null);
        }}
        onOk={() => submitRetryPsa()}
        confirmLoading={!!retryModal && retryingPsaId === retryModal.id}
        okText="重试提交"
        cancelText="取消"
        destroyOnClose
      >
        {retryModal ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Alert
              type={retryError ? 'error' : 'info'}
              showIcon
              message={retryModal.applicationNo}
              description={
                retryError
                  || '将按当前申请重新向 PSA 提交开票申请。发票仍保持待开票；成功后会记录 BM 单号，失败原因会写回申请详情。'
              }
            />
          </Space>
        ) : null}
      </Modal>

      <Modal
        open={!!reasonModal}
        title={reasonModal ? REASON_TITLE[reasonModal.kind] : ''}
        zIndex={1100}
        onCancel={() => {
          setReasonModal(null);
          setReasonText('');
        }}
        onOk={() => void submitReasonAction()}
        confirmLoading={acting}
        okText="确认"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <TextArea
          rows={3}
          placeholder="请输入原因（必填，将记入发票流转日志）"
          value={reasonText}
          maxLength={500}
          onChange={(e) => setReasonText(e.target.value)}
        />
      </Modal>

      <Modal
        open={!!issueModal}
        title="上传票据并发布"
        zIndex={1100}
        onCancel={() => {
          if (issuing) return;
          setIssueModal(null);
          issueForm.resetFields();
        }}
        onOk={() => void submitManualIssue()}
        confirmLoading={issuing}
        okText="发布给用户"
        cancelText="取消"
        destroyOnClose
        width={640}
      >
        {issueModal ? (
          <div>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={deploymentLabel(deployment)}
              description={`申请单 ${issueModal.inv.applicationNo}${issueModal.itemId ? ` / 订单 ${issueModal.inv.items.find((item) => item.id === issueModal.itemId)?.orderId ?? ''}` : ''}，金额 ${formatCurrencyCents(issueModal.inv.totalCents, issueModal.inv.currency)}。多订单申请需逐张上传，全部完成后用户可一次下载全部发票。`}
            />
            <Form form={issueForm} layout="vertical">
              <Form.Item
                name="invoiceNumber"
                label="发票号码"
                rules={[
                  { required: true, message: '请输入发票号码' },
                  {
                    validator: async (_, value: string) => {
                      if (!value?.trim() || !issueModal) return;
                      const pool = [issueModal.inv, ...data.filter((item) => item.id !== issueModal.inv.id)];
                      if (invoiceNumberTaken(value, pool, { applicationId: issueModal.inv.id, itemId: issueModal.itemId })) {
                        throw new Error('发票号码已被使用，请更换号码');
                      }
                    },
                  },
                ]}
              >
                <Input maxLength={64} placeholder="请输入税控平台开具的发票号码" />
              </Form.Item>
              <Form.Item
                name="issuingEntity"
                label="开票主体"
                rules={[{ required: true, message: '请输入开票主体' }]}
              >
                <Input maxLength={64} placeholder="请输入开票主体" />
              </Form.Item>
              <Form.Item
                name="issueDate"
                label="开票日期"
                rules={[{ required: true, message: '请选择开票日期' }]}
              >
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="taxAmountCents" label="税额（分）">
                <StableNumberInput min={0} precision={0} style={{ width: 180 }} />
              </Form.Item>
              <Form.Item
                name="pdfFile"
                label="发票 PDF"
                valuePropName="fileList"
                getValueFromEvent={uploadFileList}
                rules={[{ required: true, message: '请上传发票 PDF' }]}
              >
                <Upload
                  accept="application/pdf,.pdf"
                  maxCount={1}
                  beforeUpload={() => false}
                >
                  <Button icon={<UploadOutlined />}>选择 PDF</Button>
                </Upload>
              </Form.Item>
              <Form.Item
                name="ofdFile"
                label="OFD 文件"
                valuePropName="fileList"
                getValueFromEvent={uploadFileList}
              >
                <Upload
                  accept=".ofd,application/octet-stream"
                  maxCount={1}
                  beforeUpload={() => false}
                >
                  <Button icon={<UploadOutlined />}>选择 OFD（可选）</Button>
                </Upload>
              </Form.Item>
            </Form>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
