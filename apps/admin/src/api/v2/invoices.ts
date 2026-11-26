import api from '../axios';

export type InvoiceStatus =
  | 'PENDING_REVIEW'
  | 'APPROVED_ISSUING'
  | 'ISSUED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'FAILED'
  | 'VOIDED'
  | 'RED_OFFSET';

export type InvoicePsaStatus = 'NOT_SUBMITTED' | 'SUBMITTING' | 'SUBMITTED' | 'FAILED';

export interface InvoiceItem {
  id: string;
  orderId: string;
  principalCents: number;
  description: string;
  productName?: string | null;
  serviceStart?: string | null;
  serviceEnd?: string | null;
  poNumber?: string | null;
  invoiceNumber?: string | null;
  issuingEntity?: string | null;
  issueDate?: string | null;
  issuedAt?: string | null;
  pdfUrl?: string | null;
  ofdUrl?: string | null;
  psaFormNo?: string | null;
}

export interface InvoiceUser {
  id: string;
  email?: string | null;
  nickname?: string | null;
}

export interface InvoiceApplication {
  id: string;
  applicationNo: string;
  userId: string;
  tenantId: string | null;
  profileSnapshot?: InvoiceProfileSnapshot | null;
  currency: string;
  subtotalCents: number;
  taxAmountCents?: number | null;
  totalCents: number;
  status: InvoiceStatus;
  invoiceNumber: string | null;
  issuingEntity: string | null;
  issueDate: string | null;
  dueDate: string | null;
  pdfUrl: string | null;
  createdAt: string;
  items: InvoiceItem[];
  events?: InvoiceEvent[];
  user?: InvoiceUser | null;
  psaStatus?: InvoicePsaStatus | string;
  psaFormNo?: string | null;
  psaSubmittedAt?: string | null;
  psaLastAttemptAt?: string | null;
  psaAttemptCount?: number;
  psaLastError?: string | null;
  /** 海外 PSA 形式发票 xlsx 对象存储 key，不要和税票 pdfUrl 混用 */
  psaAttachmentUrl?: string | null;
}

export interface InvoiceProfileSnapshot {
  id?: string;
  kind?: string;
  invoiceType?: string;
  title?: string;
  taxNo?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  registeredAddress?: string | null;
  registeredPhone?: string | null;
  recipientName?: string | null;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  recipientAddress?: string | null;
}

export interface InvoiceEvent {
  id: string;
  fromStatus?: InvoiceStatus | null;
  toStatus: InvoiceStatus;
  actorType?: string | null;
  actorId?: string | null;
  reason?: string | null;
  metadata?: unknown;
  occurredAt: string;
}

export interface InvoiceListResult {
  items: InvoiceApplication[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface InvoiceListParams {
  page?: number;
  pageSize?: number;
  status?: InvoiceStatus | '';
  email?: string;
  username?: string;
  orderId?: string;
  productName?: string;
  applicationNo?: string;
  invoiceNumber?: string;
  issuedFrom?: string;
  issuedTo?: string;
}

export type InvoiceDeployment = 'domestic' | 'international';

export interface IssueManualInvoiceBody {
  invoiceNumber: string;
  issuingEntity: string;
  issueDate: string;
  taxAmountCents?: number | null;
  pdfFile: File;
  ofdFile?: File | null;
}

export type InvoiceRepairAction =
  | 'none'
  | 'update_in_place'
  | 'red_offset_and_reissue'
  | 'skipped';

export interface InvoiceRepairItemPlan {
  itemId?: string;
  orderId: string;
  previousPrincipalCents: number;
  expectedPrincipalCents: number;
}

export interface InvoiceRepairPlan {
  applicationId: string;
  applicationNo: string;
  invoiceNumber: string | null;
  status: InvoiceStatus;
  action: InvoiceRepairAction;
  reason: string | null;
  previousSubtotalCents: number;
  expectedSubtotalCents: number;
  previousTotalCents: number;
  expectedTotalCents: number;
  deltaCents: number;
  orderIds: string[];
  replacementApplicationId?: string;
  items: InvoiceRepairItemPlan[];
}

export interface InvoiceRepairResult {
  dryRun: boolean;
  scanned: number;
  candidates: number;
  repaired: number;
  skipped: number;
  items: InvoiceRepairPlan[];
}

export interface InvoiceBatchApproveResult {
  succeeded: string[];
  failed: Array<{ id: string; message: string }>;
}

interface UploadedInvoiceFileBody {
  filename: string;
  contentType: string | null;
  base64: string;
}

export const invoiceApi = {
  list: (params: InvoiceListParams = {}): Promise<InvoiceListResult> =>
    api.get('/admin/invoices', { params }).then((r) => r.data.data),

  getDetail: (id: string): Promise<InvoiceApplication> =>
    api.get(`/admin/invoices/${id}`).then((r) => r.data.data),

  getDeployment: (): Promise<{ deployment: InvoiceDeployment }> =>
    api.get('/admin/invoices/deployment').then((r) => r.data.data),

  /** 单选/多选统一打包下载 zip。 */
  downloadZip: async (ids: string[]): Promise<void> => {
    const res = await api.post(
      '/admin/invoices/download',
      { ids },
      { responseType: 'blob' },
    );
    const disposition = res.headers['content-disposition'] as string | undefined;
    const match = disposition?.match(/filename="?([^"]+)"?/i);
    const filename = match?.[1] ?? 'invoices.zip';
    const blob = new Blob([res.data], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /** 下载海外 PSA 形式发票 xlsx（对象存储由 billing 代理，不走 presigned URL）。 */
  downloadPsaAttachment: async (id: string): Promise<void> => {
    const res = await api.get(`/admin/invoices/${id}/psa-attachment`, { responseType: 'blob' });
    const disposition = res.headers['content-disposition'] as string | undefined;
    const match = disposition?.match(/filename="?([^"]+)"?/i);
    const filename = match?.[1] ?? 'invoice.xlsx';
    const blob = new Blob([res.data], {
      type: res.headers['content-type'] || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  // ---- 失败补救 / 流转（需 admin.orders.manage）----

  /** 审核通过（PENDING_REVIEW → APPROVED_ISSUING）。 */
  approve: (id: string, remark?: string | null): Promise<InvoiceApplication> =>
    api.post(`/admin/invoices/${id}/approve`, { remark }).then((r) => r.data.data),

  /**
   * 批量审核通过：逐张走现有 approve，避免一次请求卡在 nginx 60s 超时。
   * 部分失败不中断后续，调用方按 succeeded/failed 提示。
   */
  approveMany: async (ids: string[], remark?: string | null): Promise<InvoiceBatchApproveResult> => {
    const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    const succeeded: string[] = [];
    const failed: Array<{ id: string; message: string }> = [];
    for (const id of uniqueIds) {
      try {
        await invoiceApi.approve(id, remark);
        succeeded.push(id);
      } catch (err) {
        failed.push({ id, message: invoiceClientError(err, '审核通过失败') });
      }
    }
    return { succeeded, failed };
  },

  /** 重试向 PSA 提交开票申请（发票状态保持 APPROVED_ISSUING）。 */
  retryPsa: (id: string): Promise<InvoiceApplication> =>
    api.post(`/admin/invoices/${id}/psa-retry`).then((r) => r.data.data),

  /** 驳回申请（PENDING_REVIEW → REJECTED）。 */
  reject: (id: string, reason: string): Promise<InvoiceApplication> =>
    api.post(`/admin/invoices/${id}/reject`, { reason }).then((r) => r.data.data),

  /** 人工开票：上传票据并发布给用户下载。 */
  issueManual: async (id: string, body: IssueManualInvoiceBody, itemId?: string | null): Promise<InvoiceApplication> => {
    const payload = {
      invoiceNumber: body.invoiceNumber,
      issuingEntity: body.issuingEntity,
      issueDate: body.issueDate,
      taxAmountCents: body.taxAmountCents ?? null,
      itemId: itemId ?? null,
      pdfFile: await fileToBody(body.pdfFile),
      ofdFile: body.ofdFile ? await fileToBody(body.ofdFile) : null,
    };
    const path = itemId
      ? `/admin/invoices/${id}/items/${itemId}/issue-upload`
      : `/admin/invoices/${id}/issue-upload`;
    return api.post(path, payload).then((r) => r.data.data);
  },

  /** 作废（ISSUED → VOIDED）。 */
  void: (id: string, reason: string): Promise<unknown> =>
    api.post(`/admin/invoices/${id}/void`, { reason }).then((r) => r.data.data),

  /** 红冲（ISSUED → RED_OFFSET）。 */
  redOffset: (id: string, reason: string): Promise<unknown> =>
    api.post(`/admin/invoices/${id}/red-offset`, { reason }).then((r) => r.data.data),

  /** 标记失败（APPROVED_ISSUING → FAILED）。 */
  fail: (id: string, reason: string): Promise<unknown> =>
    api.post(`/admin/invoices/${id}/fail`, { reason }).then((r) => r.data.data),

  /** 国际充值错金额发票：dryRun 预览；执行时已开票会红冲旧票并新建待审核申请。 */
  reissue: (id: string, dryRun = false): Promise<InvoiceRepairResult> =>
    api.post(`/admin/invoices/${id}/reissue`, { dryRun }).then((r) => r.data.data),
};

function invoiceClientError(error: unknown, fallback: string) {
  const responseMessage = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
  if (typeof responseMessage === 'string' && responseMessage.trim()) return responseMessage;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

async function fileToBody(file: File): Promise<UploadedInvoiceFileBody> {
  return {
    filename: file.name,
    contentType: file.type || null,
    base64: await fileToBase64(file),
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}
