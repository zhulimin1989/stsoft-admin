import { useCallback, useEffect, useRef, useState } from 'react';
import {
  App,
  Button,
  Form,
  Segmented,
  Select,
  Space,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  BalanceAdjustmentModal,
  PageHeader,
  FilterBar,
  DetailDrawer,
  type BalanceAdjustmentFormValues,
} from '../../components/common';
import { usePermission } from '../../hooks/usePermission';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import {
  enterpriseAccountApi,
  type EnterpriseAccount,
  type EnterpriseAccountCreditEvent,
  type EnterpriseAccountDetail,
  type EnterpriseModelDiscountRow,
  type EnterpriseVerificationSnapshot,
  type ReviewApplication,
  type ReviewApplicationDetail,
} from '../../api/v2/enterpriseAccounts';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import {
  productApi,
} from '../../api/admin';
import { EnterpriseAccountsTable } from './components/EnterpriseAccountsTable';
import {
  AttachTenantModal,
  CreateEnterpriseAccountModal,
  CreditConfigModal,
  EnterpriseModelDiscountModal,
  RechargeEnterpriseAccountModal,
  RejectReviewModal,
} from './components/EnterpriseAccountModals';
import {
  BillingAccountView,
  ReviewApplicationView,
  VerificationView,
} from './components/EnterpriseAccountDetailViews';
import { ReviewApplicationsTable } from './components/ReviewApplicationsTable';
import {
  createSubmitGate,
  describeFundingError,
  resolveIdempotencyKey,
  submitWithReplayConfirmation,
  takeIdempotencyKey,
  type PendingIdempotency,
} from './idempotency';
import {
  REVIEW_STATUS_OPTIONS,
  accountStatusTag,
  isPaygProduct,
  reviewTag,
  toFiniteNumber,
  yuanToPositiveCents,
} from './formatters';
import type {
  AttachTenantFormValues,
  CreateEnterpriseAccountFormValues,
  CreditConfigFormValues,
  EnterpriseAccountPageMode,
  ProductOption,
  RechargeEnterpriseAccountFormValues,
  RejectReviewFormValues,
} from './types';

export default function EnterpriseAccountsPage() {
  const { message } = App.useApp();
  const platformCurrency = usePlatformCurrency();
  const platformCurrencyCode = platformCurrency.toUpperCase();
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');

  const [detail, setDetail] = useState<EnterpriseAccountDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [attachTarget, setAttachTarget] = useState<EnterpriseAccount | null>(null);
  const [creditTarget, setCreditTarget] = useState<EnterpriseAccount | null>(null);
  const [rechargeTarget, setRechargeTarget] = useState<EnterpriseAccount | null>(null);
  const [adjustmentTarget, setAdjustmentTarget] = useState<EnterpriseAccount | null>(null);
  // 资金操作的幂等键,跨重试保留、成功或关闭弹窗后清空。见 idempotency.ts
  const [, setRechargePending] = useState<PendingIdempotency>(null);
  const rechargePendingRef = useRef<PendingIdempotency>(null);
  const rechargeGateRef = useRef(createSubmitGate());
  const [adjustmentPending, setAdjustmentPending] = useState<PendingIdempotency>(null);
  const [rechargeProducts, setRechargeProducts] = useState<ProductOption[]>([]);
  const [rechargeProductLoading, setRechargeProductLoading] = useState(false);
  const [discountTarget, setDiscountTarget] = useState<EnterpriseAccount | null>(null);
  const [discountProducts, setDiscountProducts] = useState<ProductOption[]>([]);
  const [discountProductId, setDiscountProductId] = useState<string | undefined>();
  const [discountRows, setDiscountRows] = useState<EnterpriseModelDiscountRow[]>([]);
  const [discountDrafts, setDiscountDrafts] = useState<Record<string, number>>({});
  const [discountBatchValue, setDiscountBatchValue] = useState<number | null>(null);
  const [discountLoading, setDiscountLoading] = useState(false);
  const [creditEvents, setCreditEvents] = useState<EnterpriseAccountCreditEvent[]>([]);
  const [acting, setActing] = useState(false);

  const canManage = usePermission('admin.page.enterprise_accounts.manage');
  const canReview = usePermission('admin.page.enterprise_accounts.review');

  // 视图分流（§5.2）：billing 已开户账务列表 vs user 侧审核队列（待审核队列数据源必须是
  // user application list，approve 前尚无 billing account）。
  const [mode, setMode] = useState<EnterpriseAccountPageMode>('billing');

  // 审核队列状态。
  const [reviewStatusFilter, setReviewStatusFilter] = useState<string>('PENDING_REVIEW');
  const [finalOnly, setFinalOnly] = useState(false);
  const [reviewDetail, setReviewDetail] = useState<ReviewApplicationDetail | null>(null);
  /**
   * 卡住的回收作业（ALERTED）按 verificationId 索引。
   *
   * 只在打开审核抽屉时用来提示运营「需要再点一次继续作废」——那是这些作业唯一的恢复动作，
   * 而运营看不到 fanout 表。查询失败时静默降级（不影响审核主流程）。
   */
  const [stalledByVerification, setStalledByVerification] = useState<
    Map<string, Array<{ kind: string; count: number }>>
  >(new Map());

  useEffect(() => {
    let cancelled = false;
    enterpriseAccountApi
      .listRecoveryHazards({ limit: 500 })
      .then((res) => {
        if (cancelled) return;
        const next = new Map<string, Array<{ kind: string; count: number }>>();
        for (const item of res.items ?? []) {
          if (item.verificationId && (item.stalledFanout?.length ?? 0) > 0) {
            next.set(item.verificationId, item.stalledFanout);
          }
        }
        setStalledByVerification(next);
      })
      .catch(() => {
        // 只是提示信息，拿不到就不提示，不打断审核流程。
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const [reviewDetailLoading, setReviewDetailLoading] = useState(false);
  const [reviewActing, setReviewActing] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<ReviewApplicationDetail | null>(null);

  const [createForm] = Form.useForm<CreateEnterpriseAccountFormValues>();
  const [attachForm] = Form.useForm<AttachTenantFormValues>();
  const [rechargeForm] = Form.useForm<RechargeEnterpriseAccountFormValues>();
  const [creditForm] = Form.useForm<CreditConfigFormValues>();
  const [rejectForm] = Form.useForm<RejectReviewFormValues>();

  const fetchAccounts = useCallback(
    async ({ page, pageSize }: { page: number; pageSize: number }) => {
      const res = await enterpriseAccountApi.list({
        page,
        pageSize,
        ...(applied ? { search: applied.trim() } : {}),
      });
      return {
        items: Array.isArray(res?.items) ? res.items : [],
        total: typeof res?.total === 'number' ? res.total : 0,
        page: res?.page ?? page,
        pageSize: res?.pageSize ?? pageSize,
        totalPages: res?.totalPages,
      };
    },
    [applied],
  );

  const accounts = usePaginatedList<EnterpriseAccount>({
    fetcher: fetchAccounts,
    deps: [applied],
    enabled: mode === 'billing',
    onError: (err) => message.error((err as Error)?.message || '加载企业账户失败'),
  });

  const fetchReviewApplications = useCallback(
    async ({ page, pageSize }: { page: number; pageSize: number }) => {
      const res = await enterpriseAccountApi.listReviewApplications({
        page,
        pageSize,
        // 「开通失败(FINAL)」筛选：FINAL 单必然 reviewStatus=APPROVED(先审核通过才 provisioning),
        // 故此时强制 reviewStatus=APPROVED,不能沿用默认的 PENDING_REVIEW(矛盾组合会恒空,G1 作废查不到单)。
        //
        // ⚠️ 这里**只发单值**（复核 P1）：发 'FAILED_FINAL,VOIDING' 会造出新的跨仓上线顺序依赖
        // —— 新前端配旧 user-api 时，旧实现按单值等值匹配整个 CSV ⇒ 0 行 ⇒ 列表恒空,
        // 运营连 FAILED_FINAL 单都看不到,比改动前更差。
        // VOIDING 的拓宽已放到 user-api 服务端,任意上线顺序都安全。
        ...(finalOnly
          ? { reviewStatus: 'APPROVED', provisioningStatus: 'FAILED_FINAL' }
          : reviewStatusFilter
            ? { reviewStatus: reviewStatusFilter }
            : {}),
      });
      return {
        items: Array.isArray(res?.items) ? res.items : [],
        total: typeof res?.total === 'number' ? res.total : 0,
        page: res?.page ?? page,
        pageSize: res?.pageSize ?? pageSize,
        totalPages: res?.totalPages,
      };
    },
    [finalOnly, reviewStatusFilter],
  );

  const reviewApplications = usePaginatedList<ReviewApplication>({
    fetcher: fetchReviewApplications,
    deps: [reviewStatusFilter, finalOnly],
    enabled: mode === 'review',
    onError: (err) => message.error((err as Error)?.message || '加载审核队列失败'),
  });

  async function openReviewDetail(row: ReviewApplication) {
    setReviewDetailLoading(true);
    setReviewDetail({ ...row });
    try {
      const full = await enterpriseAccountApi.getReviewApplication(row.applicationId);
      setReviewDetail(full?.applicationId ? full : { ...row });
    } catch (err) {
      message.error((err as Error)?.message || '加载审核详情失败');
    } finally {
      setReviewDetailLoading(false);
    }
  }

  async function viewPaymentProof(verificationId?: string | null) {
    if (!verificationId) {
      message.warning('该申请缺少 verificationId，无法查看历史转账凭证');
      return;
    }
    try {
      const res = await enterpriseAccountApi.getPaymentProofUrl(verificationId);
      if (res?.url) {
        window.open(res.url, '_blank', 'noopener,noreferrer');
      } else {
        message.warning('该申请没有历史转账凭证，或未返回地址');
      }
    } catch (err) {
      message.error((err as Error)?.message || '获取历史转账凭证地址失败');
    }
  }

  async function refreshAfterReview(current: ReviewApplicationDetail) {
    reviewApplications.reload();
    if (reviewDetail?.applicationId === current.applicationId) {
      await openReviewDetail(current);
    }
  }

  async function doApprove(row: ReviewApplicationDetail) {
    if (!row.verificationId) {
      message.error('缺少 verificationId，无法审核通过');
      return;
    }
    setReviewActing(true);
    try {
      await enterpriseAccountApi.review(row.verificationId, { action: 'approve' });
      message.success('已审核通过，开通已触发');
      await refreshAfterReview(row);
    } catch (err) {
      message.error((err as Error)?.message || '审核通过失败');
    } finally {
      setReviewActing(false);
    }
  }

  async function doVoid(row: ReviewApplicationDetail) {
    if (!row.verificationId) {
      message.error('缺少 verificationId，无法作废退回');
      return;
    }
    setReviewActing(true);
    try {
      await enterpriseAccountApi.review(row.verificationId, { action: 'void' });
      // 批一：回收后该认证**恒有墓碑**，重提一律被拒 ⇒ 不能再提示"用户可重新发起认证"。
      message.success('已完成作废并回收企业资源；重新开通需平台处理');
      await refreshAfterReview(row);
    } catch (err) {
      message.error((err as Error)?.message || '作废退回失败');
      // 失败也要拉取详情：首次作废在 billing 超时后状态已变成 VOIDING，
      // 不刷新就看不到「继续作废」入口。
      await refreshAfterReview(row).catch(() => undefined);
    } finally {
      setReviewActing(false);
    }
  }

  async function submitReject() {
    if (!rejectTarget?.verificationId) return;
    const values = await rejectForm.validateFields();
    setReviewActing(true);
    try {
      await enterpriseAccountApi.review(rejectTarget.verificationId, {
        action: 'reject',
        rejectCategory: values.rejectCategory,
        rejectReason: values.rejectReason.trim(),
        ...(values.note?.trim() ? { note: values.note.trim() } : {}),
      });
      message.success('已驳回');
      const target = rejectTarget;
      setRejectTarget(null);
      rejectForm.resetFields();
      await refreshAfterReview(target);
    } catch (err) {
      message.error((err as Error)?.message || '驳回失败');
    } finally {
      setReviewActing(false);
    }
  }

  async function openDetail(row: EnterpriseAccount) {
    setDetailLoading(true);
    setDetail({ account: row, ownerVerification: null });
    try {
      const full = await enterpriseAccountApi.getDetail(row.id);
      // 详情信封不完整时优雅降级：保留列表行账务快照，避免下游 account.* 读取抛错。
      setDetail({
        account: full?.account?.id ? full.account : row,
        ownerVerification: full?.ownerVerification ?? null,
      });
    } catch (err) {
      message.error((err as Error)?.message || '加载详情失败');
    } finally {
      setDetailLoading(false);
    }
  }

  async function submitCreate() {
    const values = await createForm.validateFields();
    setActing(true);
    try {
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
  }

  async function submitAttach() {
    if (!attachTarget) return;
    const values = await attachForm.validateFields();
    setActing(true);
    try {
      await enterpriseAccountApi.attachTenant(attachTarget.id, values.tenantId.trim());
      message.success('已挂载 tenant');
      setAttachTarget(null);
      attachForm.resetFields();
      if (detail?.account.id === attachTarget.id) {
        await openDetail(attachTarget);
      }
    } catch (err) {
      message.error((err as Error)?.message || '挂载失败');
    } finally {
      setActing(false);
    }
  }

  async function loadRechargeProducts(): Promise<ProductOption[]> {
    const res = await productApi.list();
    const list = (Array.isArray(res) ? res : res?.items || []) as ProductOption[];
    const paygProducts = list.filter(isPaygProduct);
    setRechargeProducts(paygProducts);
    return paygProducts;
  }

  async function openRecharge(row: EnterpriseAccount) {
    setRechargeTarget(row);
    rechargeForm.resetFields();
    rechargeForm.setFieldsValue({ description: '线下转账入账' });
    setRechargeProductLoading(true);
    try {
      const products = rechargeProducts.length > 0 ? rechargeProducts : await loadRechargeProducts();
      const defaultProduct = products[0];
      if (!defaultProduct?.id) {
        message.warning('暂无可关联的按量产品，请先创建 PAYG 产品');
        setRechargeTarget(null);
        return;
      }
      rechargeForm.setFieldsValue({ productId: defaultProduct.id });
    } catch (err) {
      message.error((err as Error)?.message || '加载按量产品失败');
      setRechargeTarget(null);
    } finally {
      setRechargeProductLoading(false);
    }
  }

  async function submitBalanceAdjustment(values: BalanceAdjustmentFormValues) {
    if (!adjustmentTarget) return;
    const target = adjustmentTarget;
    const amountCents = Math.round(values.amount * 100);
    const signedAmountCents = values.direction === 'CREDIT' ? amountCents : -amountCents;
    // 键绑定「一次提交意图」,重试必须复用,否则超时后重试会重复扣款。见 idempotency.ts
    const { key: idempotencyKey, pending } = resolveIdempotencyKey(
      adjustmentPending,
      'enterprise-billing-adjustment',
      target.id,
    );
    setAdjustmentPending(pending);
    setActing(true);
    try {
      // 超时后用同一幂等键自动重提来确认结果,见 idempotency.ts
      await submitWithReplayConfirmation(
        () => enterpriseAccountApi.adjustBalance(target.id, {
          amountCents: signedAmountCents,
          reasonCode: values.reasonCode,
          description: values.description.trim(),
          idempotencyKey,
        }),
        {
          onConfirming: (attempt, total) => message.loading(
            `请求超时，正在用同一幂等键确认结果（${attempt}/${total}）…请勿关闭弹窗`,
            4,
          ),
        },
      );
      message.success('企业账户余额调整成功');
      setAdjustmentPending(null);
      setAdjustmentTarget(null);
      accounts.reload();
      if (detail?.account.id === target.id) {
        await openDetail(target);
      }
    } catch (err) {
      // 失败时**不清空** pending:结果未知,下次重试要带同一个键
      message.error(describeFundingError(err, '企业账户余额调整失败'));
    } finally {
      setActing(false);
    }
  }

  async function submitRecharge() {
    if (!rechargeTarget) return;
    const values = await rechargeForm.validateFields();
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
    const target = rechargeTarget;
    if (!rechargeGateRef.current.tryEnter()) return;
    // 键绑定「一次提交意图」,重试必须复用,否则超时后重试会重复入账。见 idempotency.ts
    const idempotencyKey = takeIdempotencyKey(
      rechargePendingRef,
      'enterprise-recharge',
      target.id,
    );
    setRechargePending(rechargePendingRef.current);
    setActing(true);
    try {
      // 超时后用同一幂等键自动重提来确认结果,见 idempotency.ts
      await submitWithReplayConfirmation(
        () => enterpriseAccountApi.recharge(target.id, {
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
      setRechargePending(null);
      setRechargeTarget(null);
      rechargeForm.resetFields();
      accounts.reload();
      if (detail?.account.id === target.id) {
        await openDetail(target);
      }
    } catch (err) {
      // 失败时**不清空** pending:结果未知,下次重试要带同一个键
      message.error(describeFundingError(err, '企业账户充值失败'));
    } finally {
      rechargeGateRef.current.leave();
      setActing(false);
    }
  }

  async function loadDiscountProducts(): Promise<ProductOption[]> {
    const res = await productApi.list();
    const list = ((Array.isArray(res) ? res : res?.items || []) as ProductOption[]).filter(isPaygProduct);
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

  async function openDiscountConfig(row: EnterpriseAccount) {
    setDiscountTarget(row);
    setDiscountProductId(undefined);
    setDiscountRows([]);
    setDiscountDrafts({});
    setDiscountBatchValue(null);
    try {
      const products = discountProducts.length > 0 ? discountProducts : await loadDiscountProducts();
      const selectedProduct = products[0];
      if (!selectedProduct?.id) {
        message.warning('暂无可配置折扣的 PAYG 产品');
        setDiscountTarget(null);
        return;
      }
      await loadEnterpriseDiscountMatrix(row.id, selectedProduct.id);
    } catch (err) {
      message.error((err as Error)?.message || '加载专属折扣配置失败');
      setDiscountTarget(null);
    }
  }

  async function submitDiscountConfig() {
    if (!discountTarget || !discountProductId) return;
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
      await enterpriseAccountApi.updateModelDiscounts(discountTarget.id, {
        productId: discountProductId,
        items,
      });
      message.success('企业模型专属折扣已保存');
      const target = discountTarget;
      setDiscountTarget(null);
      setDiscountProductId(undefined);
      setDiscountRows([]);
      setDiscountDrafts({});
      setDiscountBatchValue(null);
      if (detail?.account.id === target.id) {
        await openDetail(detail.account);
      }
    } catch (err) {
      message.error((err as Error)?.message || '保存专属折扣失败');
    } finally {
      setActing(false);
    }
  }

  async function openCreditConfig(row: EnterpriseAccount) {
    setCreditTarget(row);
    setCreditEvents([]);
    setActing(true);
    try {
      const [credit, events] = await Promise.all([
        enterpriseAccountApi.getCredit(row.id),
        enterpriseAccountApi.listCreditEvents(row.id).catch(() => ({ items: [] })),
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
    } catch (err) {
      message.error((err as Error)?.message || '加载信用额度失败');
      setCreditTarget(null);
    } finally {
      setActing(false);
    }
  }

  async function submitCreditConfig() {
    if (!creditTarget) return;
    const values = await creditForm.validateFields();
    const limitCents = Math.round(Number(values.limitAmount ?? 0) * 100);
    setActing(true);
    try {
      await enterpriseAccountApi.updateCredit(creditTarget.id, {
        limitCents,
        status: values.status,
        termsDays: values.termsDays ?? null,
        expiresAt: values.expiresAt ? new Date(`${values.expiresAt}T23:59:59.999Z`).toISOString() : null,
        reason: values.reason.trim(),
        note: values.note?.trim() || null,
      });
      message.success('信用额度已更新');
      setCreditTarget(null);
      creditForm.resetFields();
      accounts.reload();
      if (detail?.account.id === creditTarget.id) {
        await openDetail(detail.account);
      }
    } catch (err) {
      message.error((err as Error)?.message || '更新信用额度失败');
    } finally {
      setActing(false);
    }
  }

  async function handleRetry(v: EnterpriseVerificationSnapshot, ownerUserId: string) {
    if (!v.id) {
      message.error('缺少 verificationId，无法重试');
      return;
    }
    setActing(true);
    try {
      await enterpriseAccountApi.retryProvisioning(v.id, ownerUserId);
      message.success('已触发开通重试');
      if (detail?.account.ownerUserId === ownerUserId) {
        await openDetail(detail.account);
      }
    } catch (err) {
      message.error((err as Error)?.message || '重试失败');
    } finally {
      setActing(false);
    }
  }

  async function viewLicense(verificationId?: string | null) {
    if (!verificationId) {
      message.warning('该企业实名没有关联营业执照');
      return;
    }
    window.open(enterpriseAccountApi.licenseFileUrl(verificationId), '_blank', 'noopener,noreferrer');
  }

  const reviewDetailTabs = reviewDetail
    ? [
        {
          key: 'review',
          label: '认证审核',
          content: (
            <ReviewApplicationView
              stalledFanout={
                reviewDetail?.verificationId
                  ? stalledByVerification.get(reviewDetail.verificationId)
                  : undefined
              }
              application={reviewDetail}
              canReview={canReview}
              acting={reviewActing}
              onViewProof={(vid) => void viewPaymentProof(vid)}
              onViewLicense={(vid) => void viewLicense(vid)}
              onApprove={(row) => void doApprove(row)}
              onReject={setRejectTarget}
              onVoid={(row) => void doVoid(row)}
            />
          ),
        },
      ]
    : [];

  const detailTabs = detail
    ? [
        {
          key: 'billing',
          label: '账务态（billing）',
          content: (
            <BillingAccountView
              account={detail.account}
              canManage={canManage}
              currency={platformCurrency}
              onRecharge={(account) => void openRecharge(account)}
              onAdjustBalance={setAdjustmentTarget}
              onConfigureCredit={(account) => void openCreditConfig(account)}
              onConfigureDiscount={(account) => void openDiscountConfig(account)}
            />
          ),
        },
        {
          key: 'verification',
          label: '认证态（user）',
          content: (
            <VerificationView
              verification={detail.ownerVerification}
              ownerUserId={detail.account.ownerUserId ?? null}
              canManage={canManage}
              canReview={canReview}
              acting={acting}
              onRetry={(verification, uid) => void handleRetry(verification, uid)}
              onViewLicense={(vid) => void viewLicense(vid)}
            />
          ),
        },
      ]
    : [];

  return (
    <div>
      <PageHeader
        title="企业账户"
        subtitle="审核队列（待审核 / 待付款 / 驳回 / 开通失败）来自 user 侧申请单；已开户账务列表来自 billing。支持人工审核、创建/补救、挂载 tenant、开通失败重试与凭证短时效查看。"
        actions={
          mode === 'billing' && canManage
            ? [
                <Button
                  key="create"
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => setCreateOpen(true)}
                >
                  创建 / 补救
                </Button>,
              ]
            : undefined
        }
      />

      <Segmented
        style={{ marginBottom: 16 }}
        value={mode}
        onChange={(v) => setMode(v as 'billing' | 'review')}
        options={[
          { label: '已开户账务', value: 'billing' },
          {
            label: `待审核队列${mode === 'review' && reviewApplications.total ? `（${reviewApplications.total}）` : ''}`,
            value: 'review',
          },
        ]}
      />

      {mode === 'billing' && (
        <>
          <FilterBar
            search={{
              placeholder: '搜索企业名称 / 统一社会信用代码 / Owner 用户',
              value: search,
              onSearch: (v) => {
                setSearch(v);
                setApplied(v);
              },
            }}
            rightActions={
              <Button icon={<ReloadOutlined />} onClick={accounts.reload}>
                刷新
              </Button>
            }
          />

          <EnterpriseAccountsTable
            rows={accounts.items}
            loading={accounts.loading}
            pagination={accounts.tablePagination}
            selectedRowKey={detail?.account.id}
            canManage={canManage}
            currency={platformCurrency}
            onOpenDetail={(row) => void openDetail(row)}
            onRecharge={(row) => void openRecharge(row)}
            onConfigureCredit={(row) => void openCreditConfig(row)}
            onConfigureDiscount={(row) => void openDiscountConfig(row)}
            onAttachTenant={setAttachTarget}
          />

          <DetailDrawer
            open={Boolean(detail)}
            onClose={() => setDetail(null)}
            title={detail?.account.enterpriseName || detail?.account.name || '企业账户详情'}
            subtitle={detail?.account.uscc ? `统一社会信用代码: ${detail.account.uscc}` : undefined}
            status={detailLoading ? <span>加载中…</span> : accountStatusTag(detail?.account.status)}
            tabs={detailTabs}
            width="46%"
          />
        </>
      )}

      {mode === 'review' && (
        <>
          <FilterBar
            rightActions={
              <Space>
                <Select
                  style={{ width: 160 }}
                  value={reviewStatusFilter}
                  onChange={setReviewStatusFilter}
                  options={REVIEW_STATUS_OPTIONS}
                />
                <Button
                  type={finalOnly ? 'primary' : 'default'}
                  onClick={() => setFinalOnly((prev) => !prev)}
                >
                  开通失败(FINAL)
                </Button>
                <Button icon={<ReloadOutlined />} onClick={reviewApplications.reload}>
                  刷新
                </Button>
              </Space>
            }
          />

          <ReviewApplicationsTable
            rows={reviewApplications.items}
            loading={reviewApplications.loading}
            pagination={reviewApplications.tablePagination}
            selectedRowKey={reviewDetail?.applicationId}
            onOpenDetail={(row) => void openReviewDetail(row)}
          />

          <DetailDrawer
            open={Boolean(reviewDetail)}
            onClose={() => setReviewDetail(null)}
            title={reviewDetail?.enterpriseName || '企业认证审核'}
            subtitle={reviewDetail?.applicationNo ? `申请编号: ${reviewDetail.applicationNo}` : undefined}
            status={reviewDetailLoading ? <span>加载中…</span> : reviewTag(reviewDetail?.reviewStatus)}
            tabs={reviewDetailTabs}
            width="46%"
          />
        </>
      )}

      <RejectReviewModal
        open={Boolean(rejectTarget)}
        form={rejectForm}
        acting={reviewActing}
        onOk={() => void submitReject()}
        onCancel={() => {
          setRejectTarget(null);
          rejectForm.resetFields();
        }}
      />

      <CreateEnterpriseAccountModal
        open={createOpen}
        form={createForm}
        acting={acting}
        onOk={() => void submitCreate()}
        onCancel={() => setCreateOpen(false)}
      />

      <AttachTenantModal
        open={Boolean(attachTarget)}
        form={attachForm}
        acting={acting}
        onOk={() => void submitAttach()}
        onCancel={() => setAttachTarget(null)}
      />

      <RechargeEnterpriseAccountModal
        open={Boolean(rechargeTarget)}
        account={rechargeTarget}
        form={rechargeForm}
        acting={acting}
        productLoading={rechargeProductLoading}
        products={rechargeProducts}
        currencyCode={platformCurrencyCode}
        onOk={() => void submitRecharge()}
        onCancel={() => {
          if (acting) return;
          setRechargeTarget(null);
          // 关闭即结束本次提交意图,下次打开是新的一笔
          rechargePendingRef.current = null;
          setRechargePending(null);
          rechargeForm.resetFields();
        }}
      />

      <BalanceAdjustmentModal
        open={Boolean(adjustmentTarget)}
        loading={acting}
        entityLabel={
          adjustmentTarget?.enterpriseName || adjustmentTarget?.name || adjustmentTarget?.id || '企业账户'
        }
        currencyCode={platformCurrencyCode}
        currentBalanceCents={
          adjustmentTarget?.credit?.accountBalanceCents
          ?? (adjustmentTarget ? Math.round(Number(adjustmentTarget.balanceUsd ?? 0) * 100) : null)
        }
        onSubmit={submitBalanceAdjustment}
        onCancel={() => {
          setAdjustmentTarget(null);
          // 关闭即结束本次提交意图,下次打开是新的一笔
          setAdjustmentPending(null);
        }}
      />

      <EnterpriseModelDiscountModal
        open={Boolean(discountTarget)}
        acting={acting}
        loading={discountLoading}
        products={discountProducts}
        productId={discountProductId}
        rows={discountRows}
        drafts={discountDrafts}
        batchValue={discountBatchValue}
        currency={platformCurrency}
        onOk={() => void submitDiscountConfig()}
        onCancel={() => {
          setDiscountTarget(null);
          setDiscountProductId(undefined);
          setDiscountRows([]);
          setDiscountDrafts({});
          setDiscountBatchValue(null);
        }}
        onProductChange={(value) => {
          if (!discountTarget) return;
          void loadEnterpriseDiscountMatrix(discountTarget.id, value)
            .catch((err) => message.error((err as Error)?.message || '加载专属折扣配置失败'));
        }}
        onBatchValueChange={setDiscountBatchValue}
        onApplyBatch={() => {
          if (discountBatchValue == null) return;
          setDiscountDrafts(Object.fromEntries(
            discountRows.map((row) => [row.modelName, discountBatchValue]),
          ));
        }}
        onDraftChange={(modelName, value) => {
          setDiscountDrafts((current) => ({
            ...current,
            [modelName]: value,
          }));
        }}
      />

      <CreditConfigModal
        open={Boolean(creditTarget)}
        form={creditForm}
        acting={acting}
        currency={platformCurrency}
        currencyCode={platformCurrencyCode}
        creditEvents={creditEvents}
        onOk={() => void submitCreditConfig()}
        onCancel={() => {
          setCreditTarget(null);
          creditForm.resetFields();
          setCreditEvents([]);
        }}
      />
    </div>
  );
}
