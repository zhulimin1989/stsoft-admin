import { Descriptions } from 'antd';
import type { EnterpriseAccountV2 } from '../../api/v2/enterpriseAccountsV2';
import { DescriptionsFixedCols } from './DescriptionsFixedCols';
import {
  certStatusTag,
  certTypeLabel,
  dash,
  fmtDateTime,
  mono,
} from './formatters';

export type VerificationSnapshot = Record<string, unknown> | null;

interface VerificationInfoSheetProps {
  verification: VerificationSnapshot;
  account?: EnterpriseAccountV2 | null;
}

function textField(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  return null;
}

/**
 * Sheet 2：认证信息。布局对齐 PRD §4.3 / mockup「认证态 user」双列网格。
 * 认证态以 user 快照为准；快照缺字段时回落 billing 账户快照，避免整页全「—」。
 */
export function VerificationInfoSheet({
  verification,
  account = null,
}: VerificationInfoSheetProps) {
  const enterpriseName = textField(verification?.enterpriseName)
    ?? account?.enterpriseName
    ?? account?.name
    ?? null;
  const uscc = textField(verification?.uscc) ?? account?.uscc ?? null;
  const verificationId = textField(verification?.id) ?? account?.verificationId ?? null;
  const legalPerson = textField(verification?.legalPersonName)
    ?? textField(verification?.legalPerson)
    ?? null;
  const channel = textField(verification?.channel)
    ?? textField(verification?.authChannel)
    ?? null;
  const verifiedAt = textField(verification?.verifiedAt) ?? account?.verifiedAt ?? null;
  const rawType = textField(verification?.type);
  const typeLabel = rawType
    ? certTypeLabel(rawType)
    : (verificationId ? '企业实名认证' : '—');
  const status = textField(verification?.status);
  const badgeStatus = textField(verification?.verificationBadgeStatus);
  const assisted = verification?.creationSource === 'ADMIN_ASSISTED';

  return (
    <div className="ea-v2-account-sheet">
      <DescriptionsFixedCols>
        <section className="ea-v2-section-card">
          <h3 className="ea-v2-section-title">
            认证态
            <span className="ea-v2-section-tag">user</span>
          </h3>
          <Descriptions column={2} size="small" bordered>
            <Descriptions.Item label="认证状态">
              {certStatusTag(status, badgeStatus)}
            </Descriptions.Item>
            <Descriptions.Item label="认证类型">{typeLabel}</Descriptions.Item>
            <Descriptions.Item label="企业名称">{dash(enterpriseName)}</Descriptions.Item>
            <Descriptions.Item label="统一社会信用代码">{mono(uscc)}</Descriptions.Item>
            <Descriptions.Item label="法定代表人">{dash(legalPerson)}</Descriptions.Item>
            <Descriptions.Item label="认证渠道">{dash(channel)}</Descriptions.Item>
            <Descriptions.Item label="实名 ID">{mono(verificationId)}</Descriptions.Item>
            <Descriptions.Item label="认证时间">{fmtDateTime(verifiedAt)}</Descriptions.Item>
            {assisted && <><Descriptions.Item label="创建来源">后台代办</Descriptions.Item><Descriptions.Item label="核实方式">{verification?.verificationMethod==='ADMIN_OFFLINE'?'运营线下核实':'待核实'}</Descriptions.Item><Descriptions.Item label="付款方式">{verification?.paymentMode==='ADMIN_WAIVED'?'免客户打款':'待核实'}</Descriptions.Item></>}
          </Descriptions>
        </section>
      </DescriptionsFixedCols>
    </div>
  );
}
