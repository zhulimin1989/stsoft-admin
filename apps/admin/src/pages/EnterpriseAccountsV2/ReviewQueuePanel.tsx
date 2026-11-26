import { useCallback, useEffect, useState } from 'react';
import { App, Button, Form, Select, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { DetailDrawer, FilterBar } from '../../components/common';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { usePermission } from '../../hooks/usePermission';
import {
  enterpriseAccountApi,
  type ReviewApplication,
  type ReviewApplicationDetail,
} from '../../api/v2/enterpriseAccounts';
import { ReviewApplicationsTable } from '../EnterpriseAccounts/components/ReviewApplicationsTable';
import { ReviewApplicationView } from '../EnterpriseAccounts/components/EnterpriseAccountDetailViews';
import { RejectReviewModal } from '../EnterpriseAccounts/components/EnterpriseAccountModals';
import { REVIEW_STATUS_OPTIONS, reviewTag } from '../EnterpriseAccounts/formatters';
import type { RejectReviewFormValues } from '../EnterpriseAccounts/types';

/**
 * 待审核队列：筛选与接口逻辑与旧企业账户页一致
 *（reviewStatus Select + 开通失败(FINAL) + listReviewApplications）。
 */
export function ReviewQueuePanel() {
  const { message } = App.useApp();
  const canReview = usePermission('admin.page.enterprise_accounts.review');

  const [params, setParams] = useSearchParams();
  const requestedStatus = params.get('reviewStatus');
  const reviewStatusFilter = REVIEW_STATUS_OPTIONS.some(option => option.value === requestedStatus) ? requestedStatus! : 'PENDING_REVIEW';
  const finalOnly = params.get('reviewFinal') === '1';
  const reviewPage = Math.max(1, parseInt(params.get('reviewPage') ?? '1', 10) || 1);
  const reviewPageSize = Math.min(100, Math.max(1, parseInt(params.get('reviewPageSize') ?? '10', 10) || 10));
  function setReviewFilter(status: string, final: boolean) {
    const next = new URLSearchParams(params);
    next.set('reviewStatus', status);
    if (final) next.set('reviewFinal', '1'); else next.delete('reviewFinal');
    next.delete('reviewPage');setParams(next);
  }
  const [reviewDetail, setReviewDetail] = useState<ReviewApplicationDetail | null>(null);
  const [reviewDetailLoading, setReviewDetailLoading] = useState(false);
  const [reviewActing, setReviewActing] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<ReviewApplicationDetail | null>(null);
  const [rejectForm] = Form.useForm<RejectReviewFormValues>();
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
        // 提示信息，失败不打断审核主流程。
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchReviewApplications = useCallback(
    async ({ page, pageSize }: { page: number; pageSize: number }) => {
      const res = await enterpriseAccountApi.listReviewApplications({
        page,
        pageSize,
        // 「开通失败(FINAL)」：FINAL 单必然 reviewStatus=APPROVED，不能沿用 PENDING_REVIEW。
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
    pageSize: reviewPageSize,
    onError: (err) => message.error((err as Error)?.message || '加载审核队列失败'),
  });
  useEffect(() => {
    if (reviewApplications.page !== reviewPage || reviewApplications.pageSize !== reviewPageSize) {
      reviewApplications.setPagination(reviewPage, reviewPageSize);
    }
    // Match the existing billing list's URL restoration without changing the fetch contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewPage, reviewPageSize, reviewApplications.loading]);

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

  function viewLicense(verificationId?: string | null) {
    if (!verificationId) {
      message.warning('该企业实名没有关联营业执照');
      return;
    }
    window.open(enterpriseAccountApi.licenseFileUrl(verificationId), '_blank', 'noopener,noreferrer');
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
      message.success('已完成作废并回收企业资源；重新开通需平台处理');
      await refreshAfterReview(row);
    } catch (err) {
      message.error((err as Error)?.message || '作废退回失败');
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

  const reviewDetailTabs = reviewDetail
    ? [
        {
          key: 'review',
          label: '认证审核',
          content: (
            <ReviewApplicationView
              stalledFanout={
                reviewDetail.verificationId
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

  return (
    <>
      <FilterBar
        rightActions={
          <Space>
            <Select
              style={{ width: 160 }}
              value={reviewStatusFilter}
              onChange={(value) => setReviewFilter(value, finalOnly)}
              options={REVIEW_STATUS_OPTIONS}
            />
            <Button
              type={finalOnly ? 'primary' : 'default'}
              onClick={() => setReviewFilter(reviewStatusFilter, !finalOnly)}
            >
              开通失败(FINAL)
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => reviewApplications.reload()}>
              刷新
            </Button>
          </Space>
        }
      />

      <ReviewApplicationsTable
        rows={reviewApplications.items}
        loading={reviewApplications.loading}
        pagination={{ ...reviewApplications.tablePagination, onChange: (nextPage, nextSize) => {
          const next = new URLSearchParams(params);next.set('reviewPage', String(nextPage));next.set('reviewPageSize', String(nextSize));setParams(next);
        } }}
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
    </>
  );
}
