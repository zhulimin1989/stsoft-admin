import { Alert, Button, Descriptions, Popconfirm, Space } from 'antd';
import {
  AuditOutlined,
  CheckOutlined,
  CloseOutlined,
  CreditCardOutlined,
  FileImageOutlined,
  PayCircleOutlined,
  PercentageOutlined,
  RedoOutlined,
} from '@ant-design/icons';
import type {
  EnterpriseAccountDetail,
  EnterpriseAccountOwnerMember,
  EnterpriseAccountTenant,
  EnterpriseVerificationSnapshot,
  ReviewApplicationDetail,
} from '../../../api/v2/enterpriseAccounts';
import { EnterpriseCreditPolicyBoundary } from './EnterpriseCreditPolicyBoundary';
import {
  ProvisioningErrorDetail,
  accountStatusTag,
  canRetry,
  fmtDateTime,
  formatCnyAmount,
  formatMoneyAmount,
  formatMoneyCents,
  provisioningTag,
  rawVerificationTag,
  reviewTag,
  verificationTag,
} from '../formatters';

/** 业务方要求：审核详情不展示「运营备注」。字段与展示分支保留，仅关闭渲染。 */
const REVIEW_NOTE_VISIBLE: boolean = false;

interface BillingAccountViewProps {
  account: EnterpriseAccountDetail['account'];
  canManage: boolean;
  currency: string;
  onRecharge: (account: EnterpriseAccountDetail['account']) => void;
  onAdjustBalance: (account: EnterpriseAccountDetail['account']) => void;
  onConfigureCredit: (account: EnterpriseAccountDetail['account']) => void;
  onConfigureDiscount: (account: EnterpriseAccountDetail['account']) => void;
}

export function BillingAccountView({
  account,
  canManage,
  currency,
  onRecharge,
  onAdjustBalance,
  onConfigureCredit,
  onConfigureDiscount,
}: BillingAccountViewProps) {
  const members: EnterpriseAccountOwnerMember[] = account.ownerMembers ?? [];
  const tenants: EnterpriseAccountTenant[] = account.tenants ?? [];
  const credit = account.credit ?? null;
  const currencyCode = currency.toUpperCase();
  const enterpriseCreditEnabled = credit?.status === 'ACTIVE'
    && (credit.activeLimitCents ?? 0) > 0
    && credit.policyBoundaryComplete
    && credit.policyRevision > 0;
  let fundingModeLabel = '预付费（与个人账户一致）';
  if (enterpriseCreditEnabled) {
    fundingModeLabel = credit?.termsDays != null
      ? `信用额度（额度 + ${credit.termsDays} 天账期）`
      : '信用额度（额度已启用，账期未配置）';
  }
  return (
    <div>
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="账户 ID">{account.id}</Descriptions.Item>
        <Descriptions.Item label="类型">{account.type || 'enterprise'}</Descriptions.Item>
        <Descriptions.Item label="企业名称">
          {account.enterpriseName || account.name || '—'}
        </Descriptions.Item>
        <Descriptions.Item label="统一社会信用代码">{account.uscc || '—'}</Descriptions.Item>
        <Descriptions.Item label="Owner 用户">{account.ownerUserId || '—'}</Descriptions.Item>
        <Descriptions.Item label="账户状态">{accountStatusTag(account.status)}</Descriptions.Item>
        <Descriptions.Item label={`余额（${currencyCode}）`}>
          {credit
            ? formatMoneyCents(credit.accountBalanceCents, currency)
            : formatMoneyAmount(account.balanceUsd, currency)}
        </Descriptions.Item>
        <Descriptions.Item label="信用额度">{formatMoneyCents(credit?.limitCents, currency)}</Descriptions.Item>
        <Descriptions.Item label="有效信用">{formatMoneyCents(credit?.activeLimitCents, currency)}</Descriptions.Item>
        <Descriptions.Item label="已用信用">{formatMoneyCents(credit?.usedCents, currency)}</Descriptions.Item>
        <Descriptions.Item label="剩余信用">{formatMoneyCents(credit?.remainingCents, currency)}</Descriptions.Item>
        <Descriptions.Item label="账户可用余额">
          {formatMoneyCents(credit?.accountAvailableBalanceCents, currency)}
        </Descriptions.Item>
        <Descriptions.Item label="信用状态">{credit?.status || '—'}</Descriptions.Item>
        <Descriptions.Item label="资金处理方式">{fundingModeLabel}</Descriptions.Item>
        <Descriptions.Item label="授信策略时间边界">
          {credit ? (
            <EnterpriseCreditPolicyBoundary snapshot={credit} />
          ) : (
            <span>未开通信用额度，按个人预付费处理</span>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="信用到期">{fmtDateTime(credit?.expiresAt)}</Descriptions.Item>
        <Descriptions.Item label="来源实名 ID">{account.verificationId || '—'}</Descriptions.Item>
        <Descriptions.Item label="创建时间">{fmtDateTime(account.createdAt)}</Descriptions.Item>
      </Descriptions>

      {canManage && (
        <Space style={{ marginTop: 12 }}>
          <Button icon={<PayCircleOutlined />} onClick={() => onRecharge(account)}>
            充值
          </Button>
          <Button icon={<CreditCardOutlined />} onClick={() => onAdjustBalance(account)}>
            调整余额
          </Button>
          <Button icon={<CreditCardOutlined />} onClick={() => onConfigureCredit(account)}>
            配置信用额度
          </Button>
          <Button icon={<PercentageOutlined />} onClick={() => onConfigureDiscount(account)}>
            配置专属折扣
          </Button>
        </Space>
      )}

      <h4 style={{ margin: '16px 0 8px' }}>Owner 成员</h4>
      {members.length === 0 ? (
        <span style={{ color: '#888' }}>无</span>
      ) : (
        <Descriptions column={1} size="small" bordered>
          {members.map((member) => (
            <Descriptions.Item key={member.userId} label={member.userId}>
              {(member.role || 'owner')} · {member.status || '—'}
            </Descriptions.Item>
          ))}
        </Descriptions>
      )}

      <h4 style={{ margin: '16px 0 8px' }}>已挂载 Tenant</h4>
      {tenants.length === 0 ? (
        <span style={{ color: '#888' }}>无</span>
      ) : (
        <Descriptions column={1} size="small" bordered>
          {tenants.map((tenant) => (
            <Descriptions.Item key={tenant.tenantId} label={tenant.tenantId}>
              {(tenant.name || '—')} · {tenant.type || '—'} · {tenant.status || '—'}
            </Descriptions.Item>
          ))}
        </Descriptions>
      )}
    </div>
  );
}

interface VerificationViewProps {
  verification: EnterpriseVerificationSnapshot | null;
  ownerUserId: string | null;
  canManage: boolean;
  canReview: boolean;
  acting: boolean;
  onRetry: (verification: EnterpriseVerificationSnapshot, ownerUserId: string) => void;
  onViewLicense: (verificationId?: string | null) => void;
}

export function VerificationView({
  verification,
  ownerUserId,
  canManage,
  canReview,
  acting,
  onRetry,
  onViewLicense,
}: VerificationViewProps) {
  if (!verification) {
    return <span style={{ color: '#888' }}>该账户 owner 无企业实名记录，或实名查询暂不可用。</span>;
  }
  return (
    <div>
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="实名 ID">{verification.id || '—'}</Descriptions.Item>
        <Descriptions.Item label="认证类型">{verification.type || '—'}</Descriptions.Item>
        <Descriptions.Item label="认证状态">
          {verificationTag(verification.status, verification.verificationBadgeStatus)}
        </Descriptions.Item>
        <Descriptions.Item label="实名原始状态">{rawVerificationTag(verification.status)}</Descriptions.Item>
        <Descriptions.Item label="审核状态">{reviewTag(verification.reviewStatus)}</Descriptions.Item>
        <Descriptions.Item label="企业名称">{verification.enterpriseName || '—'}</Descriptions.Item>
        <Descriptions.Item label="统一社会信用代码">{verification.uscc || '—'}</Descriptions.Item>
        <Descriptions.Item label="认证时间">{fmtDateTime(verification.verifiedAt)}</Descriptions.Item>
        <Descriptions.Item label="开通状态">{provisioningTag(verification.provisioningStatus)}</Descriptions.Item>
        <Descriptions.Item label="最近错误">
          <ProvisioningErrorDetail error={verification.provisioningLastError} />
        </Descriptions.Item>
        <Descriptions.Item label="Tenant ID">{verification.tenantId || '—'}</Descriptions.Item>
        <Descriptions.Item label="Billing 账户 ID">{verification.billingAccountId || '—'}</Descriptions.Item>
      </Descriptions>

      <Space style={{ marginTop: 16 }}>
        {canReview && (
          <Button icon={<FileImageOutlined />} onClick={() => onViewLicense(verification.id)}>
            查看营业执照
          </Button>
        )}
        {canManage && (
          <Button
            danger={false}
            type="primary"
            icon={<RedoOutlined />}
            disabled={!canRetry(verification) || !ownerUserId}
            loading={acting}
            onClick={() => ownerUserId && onRetry(verification, ownerUserId)}
          >
            重试开通
          </Button>
        )}
      </Space>
      {!canRetry(verification) && (
        <p style={{ color: '#888', marginTop: 8 }}>
          仅「开通失败，可重试（FAILED_RETRYABLE）」状态可触发重试。
        </p>
      )}
    </div>
  );
}

interface ReviewApplicationViewProps {
  application: ReviewApplicationDetail;
  canReview: boolean;
  acting: boolean;
  onViewProof: (verificationId?: string | null) => void;
  onViewLicense: (verificationId?: string | null) => void;
  onApprove: (application: ReviewApplicationDetail) => void;
  onReject: (application: ReviewApplicationDetail) => void;
  onVoid: (application: ReviewApplicationDetail) => void;
  /**
   * 该单名下已耗尽重试、停在 ALERTED 的回收作业（来自 billing 的只读 /hazards）。
   *
   * 必须显式展示：这些作业的唯一出口是**再点一次「继续作废」**（服务端会原子复位它们），
   * 而运营看不到 fanout 表 —— 不提示就等于要求他们凭直觉知道该再点一次。
   */
  stalledFanout?: Array<{ kind: string; count: number }>;
}

/**
 * 审核视图（§5.2）：审核态与开通态分开展示（G1）；企业名/统一社会信用代码对授权运营不脱敏（Sec-4，对账所需）。
 * 操作按 admin.enterprise_accounts.review 控制：审核通过（仅 PENDING_REVIEW）/ 驳回（选分类+原因）/
 * 作废退回（FAILED_FINAL 可发起 / VOIDING 可继续执行）。
 */
export function ReviewApplicationView({
  application,
  canReview,
  acting,
  onViewProof,
  onViewLicense,
  onApprove,
  onReject,
  onVoid,
  stalledFanout,
}: ReviewApplicationViewProps) {
  const canApprove = application.reviewStatus === 'PENDING_REVIEW';
  const canReject = application.reviewStatus === 'PENDING_REVIEW';
  // 议题二批一：作废是两阶段（FAILED_FINAL → VOIDING → VOIDED）。
  // 批一自己会把状态写成 VOIDING，因此**推进入口必须同批交付**，否则会产出无出口的中间态。
  // 同一接口，服务端按状态分流（首次发起 / 继续执行）。
  const isVoiding = application.provisioningStatus === 'VOIDING';
  const canVoid = application.provisioningStatus === 'FAILED_FINAL' || isVoiding;
  const hasProof = application.hasPaymentProof === true;
  const stalled = stalledFanout ?? [];
  return (
    <div>
      {stalled.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="有回收作业已耗尽重试，需要再点一次「继续作废」"
          description={(
            <>
              <div>
                {stalled.map((job) => `${job.kind} × ${job.count}`).join('，')}
              </div>
              <div style={{ marginTop: 4 }}>
                点「继续作废」会把它们原子复位并重新排队；这是唯一的恢复动作，无需进库操作。
              </div>
            </>
          )}
        />
      )}
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="申请编号">{application.applicationNo || '—'}</Descriptions.Item>
        <Descriptions.Item label="用户 ID">{application.userId || '—'}</Descriptions.Item>
        <Descriptions.Item label="实名 ID">{application.verificationId || '—'}</Descriptions.Item>
        <Descriptions.Item label="企业名称">{application.enterpriseName || '—'}</Descriptions.Item>
        <Descriptions.Item label="统一社会信用代码">{application.uscc || '—'}</Descriptions.Item>
        <Descriptions.Item label="企业资料核验结论">{application.verifyOutcome || '—'}</Descriptions.Item>
        <Descriptions.Item label="资料提交时间">{fmtDateTime(application.verifiedAt)}</Descriptions.Item>
        <Descriptions.Item label="审核状态">{reviewTag(application.reviewStatus)}</Descriptions.Item>
        <Descriptions.Item label="开通状态">{provisioningTag(application.provisioningStatus)}</Descriptions.Item>
        <Descriptions.Item label="转账流水号">{application.paymentReference || '—'}</Descriptions.Item>
        <Descriptions.Item label="打款金额">{formatCnyAmount(application.paymentAmount)}</Descriptions.Item>
        <Descriptions.Item label="提交时间">{fmtDateTime(application.paymentSubmittedAt)}</Descriptions.Item>
        <Descriptions.Item label="审核人">{application.reviewedBy || '—'}</Descriptions.Item>
        <Descriptions.Item label="审核时间">{fmtDateTime(application.reviewedAt)}</Descriptions.Item>
        <Descriptions.Item label="驳回分类">{application.rejectCategory || '—'}</Descriptions.Item>
        <Descriptions.Item label="驳回原因">{application.rejectReason || '—'}</Descriptions.Item>
        {REVIEW_NOTE_VISIBLE && (
          <Descriptions.Item label="运营备注">{application.reviewNote || '—'}</Descriptions.Item>
        )}
        <Descriptions.Item label="最近开通错误">
          <ProvisioningErrorDetail error={application.lastError} />
        </Descriptions.Item>
        <Descriptions.Item label="Tenant ID">{application.tenantId || '—'}</Descriptions.Item>
        <Descriptions.Item label="Billing 账户 ID">{application.billingAccountId || '—'}</Descriptions.Item>
      </Descriptions>

      {canReview && (
        <Space style={{ marginTop: 16 }} wrap>
          {hasProof ? (
            <Button
              icon={<FileImageOutlined />}
              onClick={() => onViewProof(application.verificationId)}
            >
              查看历史转账凭证
            </Button>
          ) : null}
          <Button icon={<FileImageOutlined />} onClick={() => onViewLicense(application.verificationId)}>
            查看营业执照
          </Button>
        </Space>
      )}

      {canReview ? (
        <Space style={{ marginTop: 16 }} wrap>
          <Popconfirm
            title="确认审核通过？"
            description="通过后将触发企业账户开通（provisioning）。"
            okText="通过"
            cancelText="取消"
            disabled={!canApprove || acting}
            onConfirm={() => onApprove(application)}
          >
            <Button type="primary" icon={<CheckOutlined />} disabled={!canApprove} loading={acting}>
              审核通过
            </Button>
          </Popconfirm>
          <Button danger icon={<CloseOutlined />} disabled={!canReject} onClick={() => onReject(application)}>
            驳回
          </Button>
          <Popconfirm
            title={isVoiding ? '继续执行作废？' : '确认作废退回？'}
            description={
              isVoiding
                ? '上次作废未收敛（停留在“正在回收资源”）。继续执行会重放回收：解绑工作区、失活成员、停用账户，'
                  + '并置为已驳回。重放是幂等的，不会重复扣减或重复通知。'
                : '用于开通失败（FAILED_FINAL）的申请：先回收 billing 侧资源（解绑工作区、失活成员、停用账户），'
                  + '再置为已驳回。回收后该认证不可自助重新开通，需平台处理。'
            }
            okText={isVoiding ? '继续作废' : '作废退回'}
            cancelText="取消"
            disabled={!canVoid || acting}
            onConfirm={() => onVoid(application)}
          >
            <Button icon={<AuditOutlined />} disabled={!canVoid} loading={acting}>
              {isVoiding ? '继续作废' : '作废退回'}
            </Button>
          </Popconfirm>
        </Space>
      ) : (
        <p style={{ color: '#888', marginTop: 16 }}>
          需要「企业认证审核」权限（admin.enterprise_accounts.review）才能执行审核动作。
        </p>
      )}

      <p style={{ color: '#888', marginTop: 8 }}>
        审核通过仅 PENDING_REVIEW 可用；作废退回在开通失败（FAILED_FINAL）可发起，回收未收敛（VOIDING）时可继续执行。审核态与开通态相互独立。
      </p>
    </div>
  );
}
