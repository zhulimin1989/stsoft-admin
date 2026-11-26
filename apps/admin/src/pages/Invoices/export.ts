import dayjs from 'dayjs';
import { invoiceApi, type InvoiceApplication, type InvoiceListParams, type InvoiceStatus } from '../../api/v2/invoices';

function csvCell(value: string | number | null | undefined): string {
  let text = String(value ?? '');
  // 用户填写的抬头等字段按文本导出，避免被表格软件执行为公式。
  if (/^\s*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function uniqueJoin(values: Array<string | null | undefined>): string {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].join('; ');
}

function formatDate(value?: string | null): string {
  return value ? dayjs(value).format('YYYY-MM-DD') : '';
}

export function invoiceCsv(
  items: InvoiceApplication[],
  labels: Record<InvoiceStatus, string>,
  includeInvoiceNumber: boolean,
): string {
  const headers = [
    '申请号', '用户ID', '邮箱', '用户名', '租户ID',
    '订单号', '产品/套餐', 'PO号', '服务期起', '服务期止',
    '抬头类型', '发票类型', '抬头', '税号',
    '开户银行', '银行账号', '注册地址', '注册电话',
    '接收人', '接收邮箱', '接收电话', '收件地址',
    '币种', '未税金额', '税额', '总金额', '状态',
    ...(includeInvoiceNumber ? ['发票号'] : []),
    '开票主体', '开票日', '到期日', '申请时间',
    'PSA状态', 'BM单号', 'PSA失败原因',
  ];
  const psaLabels: Record<string, string> = {
    NOT_SUBMITTED: '未提交', SUBMITTING: '提交中', SUBMITTED: '已提交', FAILED: '失败',
  };
  const rows = items.map((inv) => {
    const profile = inv.profileSnapshot;
    return [
      inv.applicationNo, inv.userId, inv.user?.email, inv.user?.nickname, inv.tenantId,
      uniqueJoin(inv.items.map((item) => item.orderId)),
      uniqueJoin(inv.items.map((item) => item.productName || item.description)),
      uniqueJoin(inv.items.map((item) => item.poNumber)),
      uniqueJoin(inv.items.map((item) => formatDate(item.serviceStart))),
      uniqueJoin(inv.items.map((item) => formatDate(item.serviceEnd))),
      profile?.kind, profile?.invoiceType, profile?.title, profile?.taxNo,
      profile?.bankName, profile?.bankAccount, profile?.registeredAddress, profile?.registeredPhone,
      profile?.recipientName, profile?.recipientEmail, profile?.recipientPhone, profile?.recipientAddress,
      inv.currency,
      (inv.subtotalCents / 100).toFixed(2),
      inv.taxAmountCents == null ? '' : (inv.taxAmountCents / 100).toFixed(2),
      (inv.totalCents / 100).toFixed(2), labels[inv.status],
      ...(includeInvoiceNumber ? [inv.invoiceNumber] : []),
      inv.issuingEntity,
      formatDate(inv.issueDate),
      formatDate(inv.dueDate),
      dayjs(inv.createdAt).format('YYYY-MM-DD HH:mm:ss'),
      psaLabels[inv.psaStatus || 'NOT_SUBMITTED'] || inv.psaStatus, inv.psaFormNo, inv.psaLastError,
    ];
  });
  // BOM 便于 Excel 正确识别中文；金额与币种分列，方便财务汇总。
  return '\uFEFF' + [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export async function exportInvoiceData(
  params: InvoiceListParams,
  label: string,
  labels: Record<InvoiceStatus, string>,
): Promise<number> {
  const items: InvoiceApplication[] = [];
  const query = { ...params, pageSize: 100 };
  // 使用点击时的筛选快照；后续翻页或切换标签不会改变本次导出范围。
  for (let page = 1; ; page += 1) {
    const result = await invoiceApi.list({ ...query, page });
    if (result.items.length === 0) {
      if (page <= result.totalPages) throw new Error('发票列表已变化，请重新导出');
      break;
    }
    items.push(...result.items);
    if (page >= result.totalPages) break;
  }
  if (items.length === 0) return 0;

  const blob = new Blob([invoiceCsv(items, labels, params.status === 'ISSUED')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `发票-${label}-${dayjs().format('YYYYMMDD-HHmmss')}.csv`;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(url);
  }
  return items.length;
}
