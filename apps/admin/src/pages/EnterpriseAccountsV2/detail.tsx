import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  App,
  Button,
  DatePicker,
  Descriptions,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Tabs,
} from 'antd';
import {
  CheckOutlined,
  ClockCircleOutlined,
  CreditCardOutlined,
  DownloadOutlined,
  FormOutlined,
  GiftOutlined,
  LinkOutlined,
  PayCircleOutlined,
  PercentageOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { DataTable, StableNumberInput, Tag } from '../../components/common';
import { usePermission } from '../../hooks/usePermission';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import {
  enterpriseAccountV2Api,
  type EnterpriseAccountV2,
  type EnterpriseBillRow,
} from '../../api/v2/enterpriseAccountsV2';
import {
  AttachTenantModal,
  CreditConfigModal,
  EnterpriseModelDiscountModal,
  RechargeEnterpriseAccountModal,
} from '../EnterpriseAccounts/components/EnterpriseAccountModals';
import { productApi } from '../../api/admin';
import {
  enterpriseAccountApi,
  type EnterpriseAccountCreditEvent,
  type EnterpriseModelDiscountRow,
} from '../../api/v2/enterpriseAccounts';
import {
  createSubmitGate,
  resolveIdempotencyKey,
  submitWithReplayConfirmation,
  takeIdempotencyKey,
  describeFundingError,
  type PendingIdempotency,
} from '../EnterpriseAccounts/idempotency';
import type {
  AttachTenantFormValues,
  CreditConfigFormValues,
  ProductOption,
  RechargeEnterpriseAccountFormValues,
} from '../EnterpriseAccounts/types';
import { isPaygProduct, positiveYuanAmountRule, toFiniteNumber, yuanToPositiveCents } from '../EnterpriseAccounts/formatters';
import { accountStatusTag, dash, fmtDateTime, formatMoneyCents, moneyText, previewBillMoney } from './formatters';
import { AccountInfoSheet } from './AccountInfoSheet';
import { VerificationInfoSheet } from './VerificationInfoSheet';
import { BillActionButton } from './billActions';
import './enterpriseAccountsV2.css';

export default function EnterpriseAccountsV2DetailPage() {
  const { id = '' } = useParams();
  const [params, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const currency = usePlatformCurrency();
  const canManage = usePermission('admin.page.enterprise_accounts.manage');
  const [account, setAccount] = useState<EnterpriseAccountV2 | null>(null);
  const [verification, setVerification] = useState<Record<string, unknown> | null>(null);
  const [bills, setBills] = useState<EnterpriseBillRow[]>([]);
  const [billsLoading, setBillsLoading] = useState(false);
  const [billButtonVisible, setBillButtonVisible] = useState(false);
  const [sheet, setSheet] = useState(params.get('sheet') || 'account');
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [billAction, setBillAction] = useState<{ type: 'writeOff' | 'adjust' | 'compensate' | 'extend' | 'download'; bill: EnterpriseBillRow } | null>(null);
  const [billActionSubmitting, setBillActionSubmitting] = useState(false);
  const [discountRows, setDiscountRows] = useState<EnterpriseModelDiscountRow[]>([]);
  const [discountProductId, setDiscountProductId] = useState<string | undefined>();
  const [discountDrafts, setDiscountDrafts] = useState<Record<string, number>>({});
  const [discountBatchValue, setDiscountBatchValue] = useState<number | null>(null);
  const [discountLoading, setDiscountLoading] = useState(false);
  const [rechargeForm] = Form.useForm<RechargeEnterpriseAccountFormValues>();
  const [creditForm] = Form.useForm<CreditConfigFormValues>();
  const [attachForm] = Form.useForm<AttachTenantFormValues>();
  const [voucherForm] = Form.useForm();
  const [writeOffForm] = Form.useForm();
  const [adjustForm] = Form.useForm();
  const [compensateForm] = Form.useForm();
  const [extendForm] = Form.useForm();
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [rechargeProducts, setRechargeProducts] = useState<ProductOption[]>([]);
  const [discountProducts, setDiscountProducts] = useState<ProductOption[]>([]);
  const [rechargeProductLoading, setRechargeProductLoading] = useState(false);
  const [tenants, setTenants] = useState<Array<{ id: string; name?: string; ownerUserId?: string }>>([]);
  const rechargePendingRef = useRef<PendingIdempotency>(null);
  const voucherPendingRef = useRef<PendingIdempotency>(null);
  const rechargeGateRef = useRef(createSubmitGate());
  const voucherGateRef = useRef(createSubmitGate());
  const [compensatePending, setCompensatePending] = useState<PendingIdempotency>(null);
  const [writeOffPending, setWriteOffPending] = useState<PendingIdempotency>(null);
  const [adjustPending, setAdjustPending] = useState<PendingIdempotency>(null);
  const [extendPending, setExtendPending] = useState<PendingIdempotency>(null);
  const [acting, setActing] = useState(false);
  const [creditEvents, setCreditEvents] = useState<EnterpriseAccountCreditEvent[]>([]);

  const listParams = new URLSearchParams(params);
  listParams.delete('sheet');
  const listHref = `/enterprise-accounts-v2${listParams.toString() ? `?${listParams.toString()}` : ''}`;

  async function reloadAccount() {
    if (!id) return;
    try {
      const detail = await enterpriseAccountV2Api.get(id);
      setAccount(detail.account);
      setVerification(detail.ownerVerification);
    } catch {
      message.error('加载企业详情失败');
    }
  }

  async function reloadBills() {
    if (!id) return;
    const buttonVisibleParam = params.get('button_visible');
    const buttonVisible = buttonVisibleParam === 'true' || buttonVisibleParam === '1';
    setBillsLoading(true);
    try {
      const billData = await enterpriseAccountV2Api.listBills(id, { buttonVisible });
      setBills(billData.items ?? (Array.isArray(billData) ? billData : []));
      setBillButtonVisible(
        typeof billData.buttonVisible === 'boolean' ? billData.buttonVisible : buttonVisible,
      );
    } catch {
      message.error('加载企业账单失败');
    } finally {
      setBillsLoading(false);
    }
  }

  function changeSheet(next: string) {
    setSheet(next);
    const nextParams = new URLSearchParams(params);
    if (next === 'account') nextParams.delete('sheet');
    else nextParams.set('sheet', next);
    setSearchParams(nextParams, { replace: true });
  }

  useEffect(() => {
    void reloadAccount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (sheet !== 'bills') return;
    void reloadBills();
    // button_visible 缺省 false；仅显式 true/1 才打开操作按钮
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, sheet, params.get('button_visible')]);

  useEffect(() => {
    void productApi.list().then((data: unknown) => {
      const items = Array.isArray(data) ? data : (data as { items?: ProductOption[] })?.items ?? [];
      setProducts(items);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!id) return;
    void enterpriseAccountV2Api.listTenants(id).then((data: { items?: Array<{ id: string; name?: string; ownerUserId?: string }> }) => {
      setTenants(data.items ?? (Array.isArray(data) ? data : []));
    }).catch(() => undefined);
  }, [id]);

  async function loadRechargeProducts(): Promise<ProductOption[]> {
    const res = await productApi.list();
    const list = (Array.isArray(res) ? res : (res as { items?: ProductOption[] })?.items || []) as ProductOption[];
    const paygProducts = list.filter(isPaygProduct);
    setRechargeProducts(paygProducts);
    return paygProducts;
  }

  async function openRecharge() {
    if (!account) return;
    rechargeForm.resetFields();
    rechargeForm.setFieldsValue({ description: '线下转账入账' });
    setRechargeProductLoading(true);
    try {
      const payg = rechargeProducts.length > 0 ? rechargeProducts : await loadRechargeProducts();
      const defaultProduct = payg[0];
      if (!defaultProduct?.id) {
        message.warning('暂无可关联的按量产品，请先创建 PAYG 产品');
        return;
      }
      rechargeForm.setFieldsValue({ productId: defaultProduct.id });
      setRechargeOpen(true);
    } catch (err) {
      message.error((err as Error)?.message || '加载按量产品失败');
    } finally {
      setRechargeProductLoading(false);
    }
  }

  async function openVoucher() {
    if (!account) return;
    voucherForm.resetFields();
    try {
      let allProducts = products;
      if (allProducts.length === 0) {
        const res = await productApi.list();
        allProducts = (Array.isArray(res) ? res : (res as { items?: ProductOption[] })?.items || []) as ProductOption[];
        setProducts(allProducts);
      }
      const payg = allProducts.filter(isPaygProduct);
      const defaultProduct = payg[0];
      if (!defaultProduct?.id) {
        message.warning('暂无可关联的按量产品，请先创建 PAYG 产品');
        return;
      }

      let tenantOptions = tenants;
      if (tenantOptions.length === 0 && id) {
        try {
          const data = await enterpriseAccountV2Api.listTenants(id) as {
            items?: Array<{ id: string; name?: string; ownerUserId?: string }>;
          };
          tenantOptions = data.items ?? (Array.isArray(data) ? data as typeof tenants : []);
          setTenants(tenantOptions);
        } catch {
          // 保持空列表，由表单必填校验提示
        }
      }
      const enterpriseLabel = account.enterpriseName || account.name || '';
      const defaultTenant = tenantOptions.find((t) => t.name && enterpriseLabel && t.name === enterpriseLabel)
        ?? tenantOptions[0];

      voucherForm.setFieldsValue({
        productId: defaultProduct.id,
        tenantId: defaultTenant?.id,
        userId: account.ownerUserId,
        expiresAt: dayjs().add(31, 'day'),
      });
      setVoucherOpen(true);
    } catch (err) {
      message.error((err as Error)?.message || '打开发券弹窗失败');
    }
  }

  async function openCompensate(bill: EnterpriseBillRow) {
    compensateForm.resetFields();
    try {
      let allProducts = products;
      if (allProducts.length === 0) {
        const res = await productApi.list();
        allProducts = (Array.isArray(res) ? res : (res as { items?: ProductOption[] })?.items || []) as ProductOption[];
        setProducts(allProducts);
      }
      const payg = allProducts.filter(isPaygProduct);
      if (!payg[0]?.id) {
        message.warning('暂无可关联的按量产品，请先创建 PAYG 产品');
        return;
      }
      compensateForm.setFieldsValue({
        productId: payg[0].id,
        tenantId: tenants[0]?.id,
      });
      setCompensatePending(null);
      setBillAction({ type: 'compensate', bill });
    } catch (err) {
      message.error((err as Error)?.message || '打开补偿发券失败');
    }
  }

  async function submitRecharge() {
    if (!account) return;
    let values: RechargeEnterpriseAccountFormValues;
    try {
      values = await rechargeForm.validateFields();
    } catch {
      return;
    }
    const amountCents = yuanToPositiveCents(values.amount);
    if (amountCents == null) {
      message.error('请输入大于 0 的充值金额');
      return;
    }
    const description = values.description.trim();
    if (!description) {
      message.error('请填写充值备注');
      return;
    }
    const productId = values.productId?.trim();
    if (!productId) {
      message.error('请选择关联产品');
      return;
    }
    if (!rechargeGateRef.current.tryEnter()) return;
    const idempotencyKey = takeIdempotencyKey(
      rechargePendingRef,
      'enterprise-recharge',
      account.id,
    );
    setActing(true);
    try {
      await submitWithReplayConfirmation(
        () => enterpriseAccountApi.recharge(account.id, {
          amountCents,
          productId,
          description,
          idempotencyKey,
        }),
        {
          onConfirming: (attempt, total) => message.loading(
            `请求超时，正在用同一幂等键确认结果（${attempt}/${total}）…请勿关闭弹窗`,
            4,
          ),
        },
      );
      message.success('企业账户充值成功');
      rechargePendingRef.current = null;
      setRechargeOpen(false);
      rechargeForm.resetFields();
      await reloadAccount();
    } catch (err) {
      message.error(describeFundingError(err, '企业账户充值失败'));
    } finally {
      rechargeGateRef.current.leave();
      setActing(false);
    }
  }

  async function submitVoucher() {
    if (!account) return;
    let values: {
      tenantId: string;
      userId?: string;
      productId: string;
      amount: number;
      reason: string;
      expiresAt: { format: (pattern: string) => string };
    };
    try {
      values = await voucherForm.validateFields();
    } catch {
      return;
    }
    const amountCents = yuanToPositiveCents(values.amount);
    if (amountCents == null) {
      message.error('请输入大于 0 的发券金额');
      return;
    }
    if (!voucherGateRef.current.tryEnter()) return;
    const idempotencyKey = takeIdempotencyKey(
      voucherPendingRef,
      'enterprise-voucher',
      account.id,
    );
    setActing(true);
    try {
      await submitWithReplayConfirmation(
        () => enterpriseAccountV2Api.issueVoucher(account.id, {
          tenantId: values.tenantId,
          userId: values.userId || account.ownerUserId || '',
          productId: values.productId,
          amountCents,
          reason: values.reason,
          expiresAt: values.expiresAt.format('YYYY-MM-DD'),
          idempotencyKey,
        }),
        {
          onConfirming: (attempt, total) => message.loading(
            `请求超时，正在用同一幂等键确认结果（${attempt}/${total}）…请勿关闭弹窗`,
            4,
          ),
        },
      );
      message.success('代金券已发放');
      voucherPendingRef.current = null;
      setVoucherOpen(false);
    } catch (err) {
      message.error(describeFundingError(err, '发券失败'));
    } finally {
      voucherGateRef.current.leave();
      setActing(false);
    }
  }

  async function openCreditConfig() {
    if (!account) return;
    setCreditEvents([]);
    setActing(true);
    try {
      const [credit, events] = await Promise.all([
        enterpriseAccountApi.getCredit(account.id),
        enterpriseAccountApi.listCreditEvents(account.id).catch(() => ({ items: [] as EnterpriseAccountCreditEvent[] })),
      ]);
      creditForm.setFieldsValue({
        limitAmount: (credit.limitCents ?? 0) / 100,
        status: (credit.status as 'ACTIVE' | 'DISABLED' | 'SUSPENDED') || 'DISABLED',
        termsDays: credit.termsDays ?? null,
        expiresAt: credit.expiresAt ? credit.expiresAt.slice(0, 10) : null,
        reason: '',
        note: credit.note ?? null,
      });
      setCreditEvents(Array.isArray(events?.items) ? events.items : []);
      setCreditOpen(true);
    } catch (err) {
      message.error((err as Error)?.message || '加载信用额度失败');
    } finally {
      setActing(false);
    }
  }

  async function submitCreditConfig() {
    if (!account) return;
    const values = await creditForm.validateFields();
    const limitCents = Math.round(Number(values.limitAmount ?? 0) * 100);
    setActing(true);
    try {
      await enterpriseAccountApi.updateCredit(account.id, {
        limitCents,
        status: values.status,
        termsDays: values.termsDays ?? null,
        expiresAt: values.expiresAt ? new Date(`${values.expiresAt}T23:59:59.999Z`).toISOString() : null,
        reason: values.reason.trim(),
        note: values.note?.trim() || null,
      });
      message.success('信用额度已更新');
      setCreditOpen(false);
      creditForm.resetFields();
      // 与旧版列表页一致：写完授信后刷新列表缓存
      await enterpriseAccountApi.list({ page: 1, pageSize: 20 }).catch(() => undefined);
      await reloadAccount();
    } catch (err) {
      message.error((err as Error)?.message || '更新信用额度失败');
    } finally {
      setActing(false);
    }
  }

  async function loadDiscountProducts(): Promise<ProductOption[]> {
    const res = await productApi.list();
    const list = ((Array.isArray(res) ? res : (res as { items?: ProductOption[] })?.items || []) as ProductOption[])
      .filter(isPaygProduct);
    setDiscountProducts(list);
    return list;
  }

  async function loadEnterpriseDiscountMatrix(accountId: string, productId: string) {
    setDiscountLoading(true);
    try {
      const matrix = await enterpriseAccountApi.listModelDiscounts(accountId, productId);
      setDiscountProductId(productId);
      setDiscountRows(matrix.items || []);
      setDiscountDrafts(Object.fromEntries(
        (matrix.items || []).map((row) => [
          row.modelName,
          toFiniteNumber(row.priceMultiplier, 1),
        ]),
      ));
    } finally {
      setDiscountLoading(false);
    }
  }

  async function openDiscountConfig() {
    if (!account) return;
    setDiscountProductId(undefined);
    setDiscountRows([]);
    setDiscountDrafts({});
    setDiscountBatchValue(null);
    try {
      const payg = discountProducts.length > 0 ? discountProducts : await loadDiscountProducts();
      const selectedProduct = payg[0];
      if (!selectedProduct?.id) {
        message.warning('暂无可配置折扣的 PAYG 产品');
        return;
      }
      await loadEnterpriseDiscountMatrix(account.id, selectedProduct.id);
      setDiscountOpen(true);
    } catch (err) {
      message.error((err as Error)?.message || '加载专属折扣配置失败');
    }
  }

  async function submitDiscountConfig() {
    if (!account || !discountProductId) return;
    if (discountRows.length === 0) {
      message.error('当前产品暂无可配置模型');
      return;
    }
    const items: Array<{ modelName: string; priceMultiplier: number; isActive: boolean }> = [];
    for (const row of discountRows) {
      const priceMultiplier = toFiniteNumber(discountDrafts[row.modelName], Number.NaN);
      if (!Number.isFinite(priceMultiplier) || priceMultiplier <= 0 || priceMultiplier > 1) {
        message.error(`模型 ${row.modelName} 的折扣倍率必须大于 0 且不超过 1`);
        return;
      }
      items.push({
        modelName: row.modelName,
        priceMultiplier,
        isActive: true,
      });
    }
    setActing(true);
    try {
      await enterpriseAccountApi.updateModelDiscounts(account.id, {
        productId: discountProductId,
        items,
      });
      message.success('企业模型专属折扣已保存');
      setDiscountOpen(false);
      setDiscountProductId(undefined);
      setDiscountRows([]);
      setDiscountDrafts({});
      setDiscountBatchValue(null);
    } catch (err) {
      message.error((err as Error)?.message || '保存专属折扣失败');
    } finally {
      setActing(false);
    }
  }

  async function submitAttach() {
    if (!account) return;
    const values = await attachForm.validateFields();
    setActing(true);
    try {
      await enterpriseAccountApi.attachTenant(account.id, values.tenantId.trim());
      message.success('已挂载 tenant');
      setAttachOpen(false);
      attachForm.resetFields();
      await reloadAccount();
    } catch (err) {
      message.error((err as Error)?.message || '挂载失败');
    } finally {
      setActing(false);
    }
  }
  return (
    <div>
      <div className="ea-v2-back-bar">
        <Button onClick={() => navigate(listHref)}>← 返回列表</Button>
      </div>
      <div className="ea-v2-detail-head">
        <div className="ea-v2-detail-title-wrap">
          <div className="ea-v2-detail-title-row">
            <h2 className="ea-v2-detail-title">
              {account?.enterpriseName || account?.name || '企业详情'}
            </h2>
            {accountStatusTag(account?.status)}
          </div>
          <div className="ea-v2-detail-uscc">
            USCC: {dash(account?.uscc)}
          </div>
        </div>
        {canManage && (
          <div className="ea-v2-detail-ops">
            <Button icon={<PayCircleOutlined />} onClick={() => void openRecharge()}>充值</Button>
            <Button icon={<GiftOutlined />} onClick={() => void openVoucher()}>发券</Button>
            <Button icon={<CreditCardOutlined />} onClick={() => void openCreditConfig()}>配置信用额度</Button>
            <Button icon={<PercentageOutlined />} onClick={() => void openDiscountConfig()}>配置专属折扣</Button>
            <Button
              hidden
              style={{ display: 'none' }}
              icon={<LinkOutlined />}
              onClick={() => {
                attachForm.resetFields();
                setAttachOpen(true);
              }}
            >
              挂载 tenant
            </Button>
          </div>
        )}
      </div>
      <Tabs
        activeKey={sheet}
        destroyOnHidden
        onChange={changeSheet}
        items={[
          {
            key: 'account',
            label: '账户信息',
            children: <AccountInfoSheet account={account} currency={currency} />,
          },
          {
            key: 'cert',
            label: '认证信息',
            children: (
              <VerificationInfoSheet verification={verification} account={account} />
            ),
          },
          {
            key: 'bills',
            label: '企业账单',
            children: sheet === 'bills' ? (
              <DataTable<EnterpriseBillRow>
                className="ea-v2-bills-table"
                rowKey="yearMonth"
                loading={billsLoading}
                dataSource={bills}
                pagination={false}
                scroll={{ x: 'max-content' }}
                rowClassName={(row) => (row.pendingCents > 0 && (row.remainingDays ?? 99) < 10 ? 'ea-v2-row-due' : '')}
                columns={[
                  {
                    title: '企业名称',
                    key: 'enterpriseName',
                    ellipsis: true,
                    render: () => account?.enterpriseName || account?.name || '—',
                  },
                  {
                    title: '账单月份',
                    dataIndex: 'yearMonth',
                    className: 'ea-v2-col-nowrap',
                  },
                  {
                    title: '请求数',
                    dataIndex: 'requestCount',
                    align: 'right',
                    onHeaderCell: () => ({ style: { textAlign: 'left' } }),
                    render: (value: number) => value || 0,
                  },
                  {
                    title: 'Token 总量',
                    dataIndex: 'tokenTotal',
                    align: 'right',
                    onHeaderCell: () => ({ style: { textAlign: 'left' } }),
                    render: (value: number) => value || 0,
                  },
                  { title: '消耗金额', align: 'right', className: 'ea-v2-col-nowrap', render: (_: unknown, row) => formatMoneyCents(row.consumeCents, currency) },
                  { title: '账户支付金额', align: 'right', className: 'ea-v2-col-nowrap', render: (_: unknown, row) => formatMoneyCents(row.accountPayCents ?? 0, currency) },
                  { title: '代金券抵扣金额', align: 'right', className: 'ea-v2-col-nowrap', render: (_: unknown, row) => formatMoneyCents(row.voucherDeductCents ?? 0, currency) },
                  { title: '信用支付金额', align: 'right', className: 'ea-v2-col-nowrap', render: (_: unknown, row) => formatMoneyCents(row.creditPayCents ?? 0, currency) },
                  { title: '欠款金额', align: 'right', className: 'ea-v2-col-nowrap', render: (_: unknown, row) => formatMoneyCents(row.debtPayCents ?? 0, currency) },
                  { title: '调整金额', align: 'right', className: 'ea-v2-col-nowrap', render: (_: unknown, row) => moneyText(row.adjustedCents, currency) },
                  { title: '应收金额', align: 'right', className: 'ea-v2-col-nowrap', render: (_: unknown, row) => moneyText(row.receivableCents, currency) },
                  // 暂时隐藏：已付款 / 待付款 / 状态 / 账期截止 / 剩余账期（恢复时去掉 hidden）
                  { title: '已付款金额', hidden: true, align: 'right', className: 'ea-v2-col-nowrap', render: (_: unknown, row) => formatMoneyCents(row.paidCents, currency) },
                  { title: '待付款金额', hidden: true, align: 'right', className: 'ea-v2-col-nowrap', render: (_: unknown, row) => moneyText(row.pendingCents, currency) },
                  { title: '状态', hidden: true, dataIndex: 'status' },
                  {
                    title: '账期截止时间',
                    hidden: true,
                    className: 'ea-v2-col-nowrap ea-v2-col-due-at',
                    render: (_: unknown, row) => (
                      /* 暂时关闭「原始死线」悬浮提示
                      <Tooltip title={row.extended ? `原始死线 ${fmtDateTime(row.originalDueAt)}` : undefined}>
                      */
                      <span className={`ea-v2-due-at${row.dueProjected ? ' ea-v2-due-projected' : ''}`}>
                        {fmtDateTime(row.dueAt)}
                        {row.extended ? <Tag variant="warn">已延期</Tag> : null}
                      </span>
                      /* </Tooltip> */
                    ),
                  },
                  {
                    title: '剩余账期',
                    hidden: true,
                    className: 'ea-v2-col-nowrap',
                    render: (_: unknown, row) => {
                      if (row.remainingDays == null) return '—';
                      if (row.dueProjected) {
                        return (
                          <span className="ea-v2-due-projected">
                            {row.remainingDays}天
                          </span>
                        );
                      }
                      return `${row.remainingDays}天`;
                    },
                  },
                  {
                    title: '操作',
                    fixed: 'right',
                    align: 'center',
                    className: 'ea-v2-col-nowrap ea-v2-col-actions',
                    render: (_: unknown, row) => (
                      <div className="ea-v2-bill-actions">
                        <BillActionButton
                          label="账单核销"
                          icon={<CheckOutlined />}
                          reason={billActionReason(billButtonVisible, row.writeOffDisabledReason)}
                          onClick={() => {
                            setWriteOffPending(null);
                            setBillAction({ type: 'writeOff', bill: row });
                          }}
                        />
                        <BillActionButton
                          label="账单调整"
                          icon={<FormOutlined />}
                          reason={billActionReason(billButtonVisible, row.adjustDisabledReason)}
                          onClick={() => {
                            setAdjustPending(null);
                            setBillAction({ type: 'adjust', bill: row });
                          }}
                        />
                        <BillActionButton
                          label="补偿发券"
                          icon={<GiftOutlined />}
                          reason={billActionReason(billButtonVisible, row.compensateDisabledReason)}
                          onClick={() => void openCompensate(row)}
                        />
                        <BillActionButton
                          label="延期"
                          icon={<ClockCircleOutlined />}
                          reason={billActionReason(billButtonVisible, row.extendDisabledReason)}
                          onClick={() => setBillAction({ type: 'extend', bill: row })}
                        />
                        <Button
                          size="small"
                          icon={<DownloadOutlined />}
                          onClick={() => setBillAction({ type: 'download', bill: row })}
                        >
                          下载
                        </Button>
                      </div>
                    ),
                  },
                ]}
              />
            ) : null,
          },
        ]}
      />

      <RechargeEnterpriseAccountModal
        open={rechargeOpen}
        account={account as never}
        form={rechargeForm}
        acting={acting}
        productLoading={rechargeProductLoading}
        products={rechargeProducts}
        currencyCode={currency.toUpperCase()}
        onOk={() => void submitRecharge()}
        onCancel={() => {
          if (acting) return;
          setRechargeOpen(false);
          rechargePendingRef.current = null;
          rechargeForm.resetFields();
        }}
      />

      <Modal
        title="发券"
        open={voucherOpen}
        confirmLoading={acting}
        maskClosable={!acting}
        closable={!acting}
        okButtonProps={{ disabled: acting }}
        cancelButtonProps={{ disabled: acting }}
        onCancel={() => {
          if (acting) return;
          setVoucherOpen(false);
          voucherPendingRef.current = null;
        }}
        onOk={() => void submitVoucher()}
      >
        <Form form={voucherForm} layout="vertical">
          <Form.Item name="productId" label="产品" rules={[{ required: true }]}>
            <Select
              options={products.filter(isPaygProduct).map((p) => ({ value: p.id, label: p.name }))}
              placeholder="选择 PAYG 产品"
            />
          </Form.Item>
          <Form.Item name="tenantId" label="Tenant" rules={[{ required: true }]}>
            <Select
              options={tenants.map((t) => ({
                value: t.id,
                label: t.name || t.id,
              }))}
              placeholder="选择 Tenant"
            />
          </Form.Item>
          <Form.Item name="userId" hidden>
            <Input />
          </Form.Item>
          <Form.Item
            name="amount"
            label="金额"
            rules={[
              { required: true, message: '请输入发券金额' },
              positiveYuanAmountRule('请输入大于 0 的发券金额'),
            ]}
          >
            <StableNumberInput min={0} precision={2} />
          </Form.Item>
          <Form.Item name="reason" label="原因" rules={[{ required: true, max: 100 }]}>
            <Input.TextArea maxLength={100} />
          </Form.Item>
          <Form.Item
            name="expiresAt"
            label="过期时间"
            rules={[{ required: true, message: '请选择过期时间' }]}
          >
            <DatePicker
              style={{ width: '100%' }}
              disabledDate={(date) => !!date && date.endOf('day').isBefore(dayjs())}
            />
          </Form.Item>
        </Form>
      </Modal>

      <CreditConfigModal
        open={creditOpen}
        form={creditForm}
        acting={acting}
        currency={currency}
        currencyCode={currency.toUpperCase()}
        creditEvents={creditEvents}
        onOk={() => void submitCreditConfig()}
        onCancel={() => {
          setCreditOpen(false);
          creditForm.resetFields();
        }}
      />

      <AttachTenantModal
        open={attachOpen}
        form={attachForm}
        acting={acting}
        onOk={() => void submitAttach()}
        onCancel={() => {
          setAttachOpen(false);
          attachForm.resetFields();
        }}
      />

      <EnterpriseModelDiscountModal
        open={discountOpen}
        acting={acting}
        loading={discountLoading}
        products={discountProducts}
        productId={discountProductId}
        rows={discountRows}
        drafts={discountDrafts}
        batchValue={discountBatchValue}
        currency={currency}
        onOk={() => void submitDiscountConfig()}
        onCancel={() => {
          setDiscountOpen(false);
          setDiscountProductId(undefined);
          setDiscountRows([]);
          setDiscountDrafts({});
          setDiscountBatchValue(null);
        }}
        onProductChange={(productId) => {
          if (!account) return;
          void loadEnterpriseDiscountMatrix(account.id, productId);
        }}
        onBatchValueChange={setDiscountBatchValue}
        onApplyBatch={() => {
          if (discountBatchValue == null) return;
          setDiscountDrafts((prev) => {
            const next = { ...prev };
            for (const row of discountRows) {
              next[row.modelName] = discountBatchValue;
            }
            return next;
          });
        }}
        onDraftChange={(modelName, value) => {
          setDiscountDrafts((prev) => ({ ...prev, [modelName]: value }));
        }}
      />
      <Modal
        title="账单核销"
        open={billAction?.type === 'writeOff'}
        confirmLoading={billActionSubmitting}
        okButtonProps={{ disabled: billActionSubmitting }}
        cancelButtonProps={{ disabled: billActionSubmitting }}
        maskClosable={!billActionSubmitting}
        closable={!billActionSubmitting}
        onCancel={() => {
          if (billActionSubmitting) return;
          setWriteOffPending(null);
          setBillAction(null);
        }}
        afterOpenChange={(open) => { if (open) writeOffForm.resetFields(); }}
        onOk={async () => {
          if (!account || !billAction || billActionSubmitting) return;
          const values = await writeOffForm.validateFields();
          const { key: idempotencyKey, pending } = resolveIdempotencyKey(
            writeOffPending,
            'enterprise-bill-write-off',
            account.id,
          );
          setWriteOffPending(pending);
          setBillActionSubmitting(true);
          try {
            await submitWithReplayConfirmation(
              () => enterpriseAccountV2Api.writeOff(account.id, billAction.bill.yearMonth, {
                amountCents: Math.round(Number(values.amount) * 100),
                note: values.note,
                idempotencyKey,
              }),
              {
                onConfirming: (attempt, total) => message.loading(
                  `请求超时，正在用同一幂等键确认结果（${attempt}/${total}）…请勿关闭弹窗`,
                  4,
                ),
              },
            );
            message.success('已账单核销');
            setWriteOffPending(null);
            setBillAction(null);
            await reloadBills();
          } catch (err) {
            message.error(describeFundingError(err, '账单核销失败'));
          } finally {
            setBillActionSubmitting(false);
          }
        }}
      >
        {billAction?.type === 'writeOff' && (
          <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label="企业名称">{account?.enterpriseName || account?.name || '—'}</Descriptions.Item>
            <Descriptions.Item label="账单月份">{billAction.bill.yearMonth}</Descriptions.Item>
            <Descriptions.Item label="消耗金额">{formatMoneyCents(billAction.bill.consumeCents, currency)}</Descriptions.Item>
            <Descriptions.Item label="调整金额">{moneyText(billAction.bill.adjustedCents, currency)}</Descriptions.Item>
            <Descriptions.Item label="应收金额">{formatMoneyCents(billAction.bill.receivableCents, currency)}</Descriptions.Item>
            <Descriptions.Item label="待付款金额">{moneyText(billAction.bill.pendingCents, currency)}</Descriptions.Item>
          </Descriptions>
        )}
        <Form form={writeOffForm} layout="vertical">
          <Form.Item
            name="amount"
            label="本次核销金额"
            rules={[
              { required: true },
              {
                validator: async (_, value) => {
                  if (!billAction || billAction.type !== 'writeOff') return;
                  const cents = Math.round(Number(value) * 100);
                  if (!Number.isFinite(cents) || cents <= 0) {
                    throw new Error('核销金额必须大于 0');
                  }
                  if (cents > billAction.bill.pendingCents) {
                    throw new Error('核销金额不可超过待付款金额');
                  }
                },
              },
            ]}
          >
            <StableNumberInput min={0.01} precision={2} max={billAction?.type === 'writeOff' ? billAction.bill.pendingCents / 100 : undefined} />
          </Form.Item>
          <Form.Item
            name="note"
            label="备注"
            rules={[{ required: true, message: '请填写备注' }, { max: 100, message: '备注不能超过 100 字' }]}
          >
            <Input.TextArea maxLength={100} showCount />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="账单调整"
        open={billAction?.type === 'adjust'}
        confirmLoading={billActionSubmitting}
        okButtonProps={{ disabled: billActionSubmitting }}
        cancelButtonProps={{ disabled: billActionSubmitting }}
        maskClosable={!billActionSubmitting}
        closable={!billActionSubmitting}
        onCancel={() => {
          if (billActionSubmitting) return;
          setAdjustPending(null);
          setBillAction(null);
        }}
        afterOpenChange={(open) => { if (open) adjustForm.resetFields(); }}
        onOk={async () => {
          if (!account || !billAction || billAction.type !== 'adjust') return;
          const values = await adjustForm.validateFields();
          const { key: idempotencyKey, pending } = resolveIdempotencyKey(
            adjustPending,
            'enterprise-bill-adjust',
            account.id,
          );
          setAdjustPending(pending);
          setBillActionSubmitting(true);
          try {
            await submitWithReplayConfirmation(
              () => enterpriseAccountV2Api.adjust(account.id, billAction.bill.yearMonth, {
                direction: values.direction,
                amountCents: Math.round(Number(values.amount) * 100),
                note: values.note,
                idempotencyKey,
              }),
              {
                onConfirming: (attempt, total) => message.loading(
                  `请求超时，正在用同一幂等键确认结果（${attempt}/${total}）…请勿关闭弹窗`,
                  4,
                ),
              },
            );
            message.success('已调整');
            setAdjustPending(null);
            setBillAction(null);
            await reloadBills();
          } catch (err) {
            message.error(describeFundingError(err, '调整失败'));
          } finally {
            setBillActionSubmitting(false);
          }
        }}
      >
        {billAction?.type === 'adjust' && (
          <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label="企业名称">{account?.enterpriseName || account?.name || '—'}</Descriptions.Item>
            <Descriptions.Item label="账单月份">{billAction.bill.yearMonth}</Descriptions.Item>
            <Descriptions.Item label="消耗金额">{formatMoneyCents(billAction.bill.consumeCents, currency)}</Descriptions.Item>
            <Descriptions.Item label="调整金额">{moneyText(billAction.bill.adjustedCents, currency)}</Descriptions.Item>
            <Descriptions.Item label="应收金额">{formatMoneyCents(billAction.bill.receivableCents, currency)}</Descriptions.Item>
            <Descriptions.Item label="待付款金额">{moneyText(billAction.bill.pendingCents, currency)}</Descriptions.Item>
          </Descriptions>
        )}
        <Form form={adjustForm} layout="vertical" initialValues={{ direction: 'increase' }}>
          <Form.Item name="direction" label="方向" rules={[{ required: true }]}>
            <Radio.Group>
              <Radio value="increase">调增</Radio>
              <Radio value="decrease">调减</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            name="amount"
            label="调整金额"
            rules={[
              { required: true },
              {
                validator: async (_, value) => {
                  if (!billAction || billAction.type !== 'adjust') return;
                  const cents = Math.round(Number(value) * 100);
                  if (!Number.isFinite(cents) || cents <= 0) {
                    throw new Error('调整金额必须大于 0');
                  }
                },
              },
            ]}
          >
            <StableNumberInput min={0.01} precision={2} />
          </Form.Item>
          <Form.Item name="note" label="调整原因" rules={[{ required: true, max: 100 }]}>
            <Input.TextArea maxLength={100} showCount />
          </Form.Item>
          <p style={{ color: '#667085', marginTop: -8 }}>
            调减可使待付款为负；勾稽保持 应收 = 已付款 + 待付款。已付清后的多收差异也可用补偿发券冲减应收。
          </p>
          {billAction?.type === 'adjust' && (
            <Form.Item noStyle shouldUpdate={(prev, next) => prev.direction !== next.direction || prev.amount !== next.amount}>
              {({ getFieldValue }) => {
                const amount = Number(getFieldValue('amount') ?? 0);
                if (!Number.isFinite(amount) || amount <= 0) return null;
                const signed = Math.round(amount * 100) * (getFieldValue('direction') === 'decrease' ? -1 : 1);
                const nextAdjusted = billAction.bill.adjustedCents + signed;
                const next = previewBillMoney(billAction.bill, { adjustedCents: nextAdjusted });
                const nextReceivable = next.receivableCents;
                const nextPending = next.pendingCents;
                return (
                  <p style={{ color: '#667085' }}>
                    应收金额 {formatMoneyCents(billAction.bill.receivableCents, currency)}
                    {' → '}{moneyText(nextReceivable, currency)}
                    {'；待付款金额 '}{formatMoneyCents(billAction.bill.pendingCents, currency)}
                    {' → '}{moneyText(nextPending, currency)}
                  </p>
                );
              }}
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal
        title="补偿发券"
        open={billAction?.type === 'compensate'}
        confirmLoading={billActionSubmitting}
        okButtonProps={{ disabled: billActionSubmitting }}
        cancelButtonProps={{ disabled: billActionSubmitting }}
        maskClosable={!billActionSubmitting}
        closable={!billActionSubmitting}
        onCancel={() => {
          if (billActionSubmitting) return;
          setCompensatePending(null);
          setBillAction(null);
        }}
        afterOpenChange={(open) => {
          if (!open) return;
          const payg = products.filter(isPaygProduct);
          compensateForm.setFieldsValue({
            productId: compensateForm.getFieldValue('productId') || payg[0]?.id,
            tenantId: compensateForm.getFieldValue('tenantId') || tenants[0]?.id,
          });
        }}
        onOk={async () => {
          if (!account || !billAction || billAction.type !== 'compensate') return;
          const values = await compensateForm.validateFields();
          const { key: idempotencyKey, pending } = resolveIdempotencyKey(
            compensatePending,
            'enterprise-bill-compensate',
            account.id,
          );
          setCompensatePending(pending);
          setBillActionSubmitting(true);
          try {
            await submitWithReplayConfirmation(
              () => enterpriseAccountV2Api.compensateVoucher(account.id, billAction.bill.yearMonth, {
                amountCents: Math.round(Number(values.amount) * 100),
                note: values.note,
                productId: values.productId,
                tenantId: values.tenantId ?? null,
                idempotencyKey,
              }),
              {
                onConfirming: (attempt, total) => message.loading(
                  `请求超时，正在用同一幂等键确认结果（${attempt}/${total}）…请勿关闭弹窗`,
                  4,
                ),
              },
            );
            message.success('已补偿发券');
            setCompensatePending(null);
            setBillAction(null);
            await reloadBills();
          } catch (err) {
            message.error(describeFundingError(err, '补偿发券失败'));
          } finally {
            setBillActionSubmitting(false);
          }
        }}
      >
        {billAction?.type === 'compensate' && (
          <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label="企业名称">{account?.enterpriseName || account?.name || '—'}</Descriptions.Item>
            <Descriptions.Item label="账单月份">{billAction.bill.yearMonth}</Descriptions.Item>
            <Descriptions.Item label="已付款金额">{formatMoneyCents(billAction.bill.paidCents, currency)}</Descriptions.Item>
            <Descriptions.Item label="发券金额">{formatMoneyCents(billAction.bill.issuedVoucherCents ?? 0, currency)}</Descriptions.Item>
            <Descriptions.Item label="应收金额">{formatMoneyCents(billAction.bill.receivableCents, currency)}</Descriptions.Item>
            <Descriptions.Item label="待付款金额">{moneyText(billAction.bill.pendingCents, currency)}</Descriptions.Item>
          </Descriptions>
        )}
        <Form form={compensateForm} layout="vertical">
          <Form.Item name="productId" label="产品" rules={[{ required: true, message: '请选择产品' }]}>
            <Select
              options={products.filter(isPaygProduct).map((p) => ({ value: p.id, label: p.name }))}
              placeholder="选择 PAYG 产品"
            />
          </Form.Item>
          <Form.Item name="tenantId" label="Tenant">
            <Select
              allowClear
              options={tenants.map((t) => ({ value: t.id, label: t.name || t.id }))}
              placeholder="可选；不选则由计费侧解析"
            />
          </Form.Item>
          <Form.Item
            name="amount"
            label="补偿金额"
            rules={[
              { required: true },
              {
                validator: async (_, value) => {
                  if (!billAction || billAction.type !== 'compensate') return;
                  const cents = Math.round(Number(value) * 100);
                  if (!Number.isFinite(cents) || cents <= 0) {
                    throw new Error('补偿金额必须大于 0');
                  }
                  if (cents > billAction.bill.paidCents) {
                    throw new Error('补偿金额不能超过已付款金额');
                  }
                },
              },
            ]}
          >
            <StableNumberInput
              min={0.01}
              precision={2}
              max={billAction?.type === 'compensate' ? billAction.bill.paidCents / 100 : undefined}
            />
          </Form.Item>
          <Form.Item name="note" label="补偿原因" rules={[{ required: true, max: 100 }]}>
            <Input.TextArea maxLength={100} showCount />
          </Form.Item>
          {billAction?.type === 'compensate' && (
            <Form.Item noStyle shouldUpdate={(prev, next) => prev.amount !== next.amount}>
              {({ getFieldValue }) => {
                const amount = Number(getFieldValue('amount') ?? 0);
                if (!Number.isFinite(amount) || amount <= 0) return null;
                const cents = Math.round(amount * 100);
                const nextIssued = (billAction.bill.issuedVoucherCents ?? 0) + cents;
                const next = previewBillMoney(billAction.bill, { issuedVoucherCents: nextIssued });
                const nextReceivable = next.receivableCents;
                const nextPending = next.pendingCents;
                return (
                  <p style={{ color: '#667085' }}>
                    发券金额 {formatMoneyCents(billAction.bill.issuedVoucherCents ?? 0, currency)}
                    {' → '}{formatMoneyCents(nextIssued, currency)}
                    {'；应收金额 '}{formatMoneyCents(billAction.bill.receivableCents, currency)}
                    {' → '}{moneyText(nextReceivable, currency)}
                    {'；待付款金额 '}{formatMoneyCents(billAction.bill.pendingCents, currency)}
                    {' → '}{moneyText(nextPending, currency)}
                  </p>
                );
              }}
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal
        title="延期"
        open={billAction?.type === 'extend'}
        confirmLoading={billActionSubmitting}
        okButtonProps={{ disabled: billActionSubmitting }}
        cancelButtonProps={{ disabled: billActionSubmitting }}
        maskClosable={!billActionSubmitting}
        closable={!billActionSubmitting}
        onCancel={() => {
          if (billActionSubmitting) return;
          setExtendPending(null);
          setBillAction(null);
        }}
        afterOpenChange={(open) => { if (open) extendForm.resetFields(); }}
        onOk={async () => {
          if (!account || !billAction || billActionSubmitting) return;
          const values = await extendForm.validateFields();
          const { key: idempotencyKey, pending } = resolveIdempotencyKey(
            extendPending,
            'enterprise-bill-extend',
            account.id,
          );
          setExtendPending(pending);
          setBillActionSubmitting(true);
          try {
            await submitWithReplayConfirmation(
              () => enterpriseAccountV2Api.extend(account.id, billAction.bill.yearMonth, {
                dueAt: values.dueAt.toISOString(),
                idempotencyKey,
              }),
              {
                onConfirming: (attempt, total) => message.loading(
                  `请求超时，正在用同一幂等键确认结果（${attempt}/${total}）…请勿关闭弹窗`,
                  4,
                ),
              },
            );
            message.success('已延期');
            setExtendPending(null);
            setBillAction(null);
            await reloadBills();
          } catch (err) {
            message.error(describeFundingError(err, '延期失败'));
          } finally {
            setBillActionSubmitting(false);
          }
        }}
      >
        <Form form={extendForm} layout="vertical">
          <Form.Item name="dueAt" label="新的账期截止时间" rules={[{ required: true }]}>
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="下载账单"
        open={billAction?.type === 'download'}
        width={440}
        className="ea-v2-download-modal"
        confirmLoading={billActionSubmitting}
        okButtonProps={{ disabled: billActionSubmitting }}
        cancelButtonProps={{ disabled: billActionSubmitting }}
        maskClosable={!billActionSubmitting}
        closable={!billActionSubmitting}
        okText="确认下载"
        cancelText="取消"
        onCancel={() => {
          if (billActionSubmitting) return;
          setBillAction(null);
        }}
        onOk={async () => {
          if (!account || !billAction || billActionSubmitting) return;
          setBillActionSubmitting(true);
          try {
            const enterpriseLabel = (account.enterpriseName || account.name || account.id)
              .replace(/[\\/:*?"<>|]/g, '_')
              .trim() || '企业账户';
            await enterpriseAccountV2Api.download(
              account.id,
              billAction.bill.yearMonth,
              `${billAction.bill.yearMonth}-${enterpriseLabel}-企业账单.xlsx`,
            );
            setBillAction(null);
          } catch (error) {
            message.error(error instanceof Error && error.message ? error.message : '下载失败');
          } finally {
            setBillActionSubmitting(false);
          }
        }}
      >
        {billAction?.type === 'download' && (
          <div className="ea-v2-download-body">
            <div className="ea-v2-download-hero">
              <div className="ea-v2-download-hero-main">
                <span className="ea-v2-download-label">账单月份</span>
                <span className="ea-v2-download-month">{billAction.bill.yearMonth}</span>
              </div>
              <Tag variant={billAction.bill.currentMonth ? 'warn' : 'success'}>
                {billAction.bill.currentMonth ? '未定格' : '已定格'}
              </Tag>
            </div>

            <div className="ea-v2-download-meta">
              <div className="ea-v2-download-row">
                <span className="ea-v2-download-label">导出时区</span>
                <span className="ea-v2-download-value">北京时间</span>
              </div>
              <div className="ea-v2-download-row">
                <span className="ea-v2-download-label">明细截止</span>
                <span className="ea-v2-download-value ea-v2-mono">
                  {billAction.bill.currentMonth
                    ? '昨天 23:59:59'
                    : frozenMonthCutoffLabel(billAction.bill.yearMonth)}
                </span>
              </div>
            </div>

            <p className="ea-v2-download-note">
              {billAction.bill.currentMonth
                ? '当月账单导出将标注未定格；明细不含当日数据。'
                : '已定格月份按自然月末导出；明细不含次月及以后数据。'}
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

function frozenMonthCutoffLabel(yearMonth: string): string {
  const [yearText, monthText] = yearMonth.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return `${yearMonth} 月末 23:59:59`;
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${yearMonth}-${String(lastDay).padStart(2, '0')} 23:59:59`;
}

/** button_visible 缺省/false 时强制置灰；仅 true 时沿用行内原有 reason。 */
function billActionReason(buttonVisible: boolean, reason: string | null): string | null {
  if (buttonVisible) return reason;
  return reason ?? '账单操作已关闭';
}
