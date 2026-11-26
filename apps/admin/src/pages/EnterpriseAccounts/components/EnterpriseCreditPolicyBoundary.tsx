import { Space, Tag } from 'antd';
import { fmtDateTime } from '../formatters';

export type EnterpriseCreditPolicyBoundaryState =
  | 'UNVERSIONED'
  | 'PENDING'
  | 'COMPLETE'
  | 'INCONSISTENT';

export interface EnterpriseCreditPolicyBoundarySnapshot {
  policyRevision?: number | null;
  policyDecisionAt?: string | null;
  policyEffectiveBoundaryAt?: string | null;
  policyBoundaryComplete?: boolean | null;
  policyFanoutEnqueuedAt?: string | null;
}

export function getEnterpriseCreditPolicyBoundaryState(
  snapshot: EnterpriseCreditPolicyBoundarySnapshot,
  requireDecisionAt = false,
): EnterpriseCreditPolicyBoundaryState {
  const revision = snapshot.policyRevision;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision <= 0) {
    return 'UNVERSIONED';
  }
  const boundaryMs = snapshot.policyEffectiveBoundaryAt
    ? new Date(snapshot.policyEffectiveBoundaryAt).getTime()
    : Number.NaN;
  const decisionMs = snapshot.policyDecisionAt
    ? new Date(snapshot.policyDecisionAt).getTime()
    : Number.NaN;
  if (requireDecisionAt && !Number.isFinite(decisionMs)) return 'INCONSISTENT';
  if (
    snapshot.policyBoundaryComplete === true
    && Number.isFinite(boundaryMs)
    && (!Number.isFinite(decisionMs) || decisionMs <= boundaryMs)
  ) {
    return 'COMPLETE';
  }
  if (snapshot.policyBoundaryComplete === false && !snapshot.policyEffectiveBoundaryAt) {
    return 'PENDING';
  }
  return 'INCONSISTENT';
}

function formatBoundaryGap(
  decisionAt?: string | null,
  boundaryAt?: string | null,
): string | null {
  if (!decisionAt || !boundaryAt) return null;
  const decisionMs = new Date(decisionAt).getTime();
  const boundaryMs = new Date(boundaryAt).getTime();
  if (!Number.isFinite(decisionMs) || !Number.isFinite(boundaryMs)) return null;
  const gapMs = boundaryMs - decisionMs;
  if (gapMs < 0) return '确认边界早于策略决策时间';
  if (gapMs < 1_000) return `${gapMs} 毫秒`;
  return `${(gapMs / 1_000).toFixed(3).replace(/\.000$/, '')} 秒`;
}

const STATE_META: Record<
  EnterpriseCreditPolicyBoundaryState,
  { label: string; color: string }
> = {
  UNVERSIONED: { label: '未建立边界', color: 'default' },
  PENDING: { label: '确认中', color: 'processing' },
  COMPLETE: { label: '已确认', color: 'success' },
  INCONSISTENT: { label: '数据异常', color: 'error' },
};

interface EnterpriseCreditPolicyBoundaryProps {
  snapshot: EnterpriseCreditPolicyBoundarySnapshot;
  showDecisionTimeline?: boolean;
  showFanout?: boolean;
}

export function EnterpriseCreditPolicyBoundary({
  snapshot,
  showDecisionTimeline = false,
  showFanout = false,
}: EnterpriseCreditPolicyBoundaryProps) {
  const state = getEnterpriseCreditPolicyBoundaryState(snapshot, showDecisionTimeline);
  const meta = STATE_META[state];
  const gap = formatBoundaryGap(
    snapshot.policyDecisionAt,
    snapshot.policyEffectiveBoundaryAt,
  );
  const revision = typeof snapshot.policyRevision === 'number' && snapshot.policyRevision > 0
    ? `v${snapshot.policyRevision}`
    : 'v—';

  return (
    <Space direction="vertical" size={2} style={{ width: '100%' }}>
      <Space size={4} wrap>
        <Tag color={meta.color}>{meta.label}</Tag>
        <span>策略 {revision}</span>
        {state === 'COMPLETE' ? (
          <span>· 生效边界 {fmtDateTime(snapshot.policyEffectiveBoundaryAt)}</span>
        ) : null}
      </Space>

      {state === 'UNVERSIONED' ? (
        <span style={{ color: '#8c8c8c', fontSize: 12 }}>
          无可验证的策略时间边界；不得据此追溯使用信用额度。
        </span>
      ) : null}
      {state === 'PENDING' ? (
        <span style={{ color: '#d46b08', fontSize: 12 }}>
          decision → confirmed gap 尚未闭合；间隙内请求按授信证据不足处理。
        </span>
      ) : null}
      {state === 'INCONSISTENT' ? (
        <span style={{ color: '#cf1322', fontSize: 12 }}>
          完成标记与确认时间不一致，需人工核查。
        </span>
      ) : null}

      {showDecisionTimeline ? (
        <span style={{ color: '#595959', fontSize: 12 }}>
          决策 {fmtDateTime(snapshot.policyDecisionAt)}
          {' → '}
          确认 {fmtDateTime(snapshot.policyEffectiveBoundaryAt)}
          {state === 'COMPLETE' && gap ? ` · decision → confirmed gap ${gap}（已闭合）` : ''}
        </span>
      ) : null}
      {showFanout ? (
        <span style={{ color: '#8c8c8c', fontSize: 12 }}>
          后续处理：{snapshot.policyFanoutEnqueuedAt
            ? `已入队 ${fmtDateTime(snapshot.policyFanoutEnqueuedAt)}`
            : '尚未记录入队'}
        </span>
      ) : null}
    </Space>
  );
}
