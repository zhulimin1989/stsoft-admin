import { Descriptions } from 'antd';
import type { EnterpriseAccountOwnerMember } from '../../api/v2/enterpriseAccounts';
import type { EnterpriseAccountV2 } from '../../api/v2/enterpriseAccountsV2';
import { EnterpriseCreditPolicyBoundary } from '../EnterpriseAccounts/components/EnterpriseCreditPolicyBoundary';
import { DescriptionsFixedCols } from './DescriptionsFixedCols';
import {
  accountStatusTag,
  creditStatusLabel,
  dash,
  dashOwner,
  fmtDateTime,
  formatMoneyCents,
  fundingModeText,
  mono,
  moneyText,
} from './formatters';

interface AccountInfoSheetProps {
  account: EnterpriseAccountV2 | null;
  currency: string;
}

export function AccountInfoSheet({ account, currency }: AccountInfoSheetProps) {
  const credit = account?.credit ?? null;
  const members: EnterpriseAccountOwnerMember[] = account?.ownerMembers ?? [];
  const fundingMode = fundingModeText(account?.prepaid, credit?.termsDays);

  return (
    <div className="ea-v2-account-sheet">
      <DescriptionsFixedCols>
        <section className="ea-v2-section-card">
          <h3 className="ea-v2-section-title">基础信息</h3>
          <Descriptions column={2} size="small" bordered>
            <Descriptions.Item label="账户 ID">{mono(account?.id)}</Descriptions.Item>
            <Descriptions.Item label="类型">{mono(account?.type || 'enterprise')}</Descriptions.Item>
            <Descriptions.Item label="企业名称">
              {account?.enterpriseName || account?.name || '—'}
            </Descriptions.Item>
            <Descriptions.Item label="统一社会信用代码">{mono(account?.uscc)}</Descriptions.Item>
            <Descriptions.Item label="Owner 用户">{mono(account?.ownerUserId)}</Descriptions.Item>
            <Descriptions.Item label="账户状态">{accountStatusTag(account?.status)}</Descriptions.Item>
            <Descriptions.Item label="来源实名 ID">{mono(account?.verificationId)}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{fmtDateTime(account?.createdAt)}</Descriptions.Item>
            <Descriptions.Item label="手机号">{dash(account?.phone)}</Descriptions.Item>
            <Descriptions.Item label="邮箱">{dash(account?.email)}</Descriptions.Item>
          </Descriptions>
        </section>

        <section className="ea-v2-section-card">
          <h3 className="ea-v2-section-title">
            账户信息
            <span className="ea-v2-section-tag">账务态 billing</span>
          </h3>
          <Descriptions column={2} size="small" bordered>
            <Descriptions.Item label={`余额（${currency.toUpperCase()}）`}>
              {moneyText(credit?.accountBalanceCents, currency)}
            </Descriptions.Item>
            <Descriptions.Item label="资金处理方式">{fundingMode}</Descriptions.Item>
            <Descriptions.Item label="企业授信（信用额度）">
              {formatMoneyCents(credit?.limitCents, currency)}
            </Descriptions.Item>
            <Descriptions.Item label="有效信用">
              {formatMoneyCents(credit?.activeLimitCents, currency)}
            </Descriptions.Item>
            <Descriptions.Item label="已用信用">
              {formatMoneyCents(credit?.usedCents, currency)}
            </Descriptions.Item>
            <Descriptions.Item label="剩余信用">
              {formatMoneyCents(credit?.remainingCents, currency)}
            </Descriptions.Item>
            <Descriptions.Item label="账户可用余额">
              {moneyText(credit?.accountAvailableBalanceCents, currency)}
            </Descriptions.Item>
            <Descriptions.Item label="信用状态">{creditStatusLabel(credit?.status)}</Descriptions.Item>
            <Descriptions.Item
              label="授信策略时间边界"
              styles={{ content: { minWidth: 0 } }}
            >
              {credit ? (
                <div className="ea-v2-desc-wrap">
                  <EnterpriseCreditPolicyBoundary snapshot={credit} />
                </div>
              ) : (
                <span>未开通信用额度，按预付款处理</span>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="授信到期时间">
              {credit?.expiresAt ? fmtDateTime(credit.expiresAt) : '长期有效'}
            </Descriptions.Item>
          </Descriptions>
        </section>

        <section className="ea-v2-section-card">
          <h3 className="ea-v2-section-title">Owner 成员</h3>
          {members.length === 0 ? (
            <div className="ea-v2-empty">{dashOwner(null)}</div>
          ) : (
            <Descriptions column={2} size="small" bordered>
              {members.map((member) => (
                <Descriptions.Item key={member.userId} label={mono(member.userId)}>
                  {(member.role || 'owner')} · {member.status || '—'}
                </Descriptions.Item>
              ))}
            </Descriptions>
          )}
        </section>
      </DescriptionsFixedCols>
    </div>
  );
}
