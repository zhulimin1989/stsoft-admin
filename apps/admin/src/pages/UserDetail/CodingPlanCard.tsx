import { Button } from 'antd';
import { Tag } from '../../components/common';
import './cards.css';

interface QuotaRow {
  windowType: 'ROLLING' | 'FIXED_PERIOD' | 'CUMULATIVE';
  durationLabel: string;
  used: number;
  limit: number;
  metric: 'requests' | 'tokens' | 'credits';
}

interface KeyRow {
  id: string;
  prefix: string;
  lastUsedAt?: string;
  isActive: boolean;
}

interface Props {
  productName: string;
  planName?: string;
  status?: string;
  expiresAt?: string | null;
  resetAt?: string;
  quotas: QuotaRow[];
  keys?: KeyRow[];
  planCredits?: { used: number; total: number };
  boosterCredits?: number;
  usedThisMonth?: number;
  onAddKey?: () => void;
  onRenew?: () => void;
  onAddQuota?: () => void;
}

const metricLabel = { requests: '请求', tokens: 'tokens', credits: '积分' };
const statusLabel: Record<string, string> = {
  ACTIVE: '生效中',
  EXPIRED: '已过期',
  CANCELLED: '已取消',
};

export function CodingPlanCard({
  productName,
  planName,
  status,
  expiresAt,
  resetAt,
  quotas,
  keys = [],
  planCredits,
  boosterCredits = 0,
  usedThisMonth = 0,
  onAddKey,
  onRenew,
  onAddQuota,
}: Props) {
  const statusText = status ? statusLabel[status] ?? status : undefined;
  const planRemaining = planCredits ? Math.max(0, planCredits.total - planCredits.used) : 0;
  const productCredits = planRemaining + boosterCredits;

  return (
    <div className="rt-pcard">
      <div className="rt-pcard-h">
        <div>
          <div className="rt-pcard-t">{productName} <Tag variant="muted">订阅 + 配额</Tag></div>
          <div className="rt-pcard-meta">
            {planName ?? '未绑定套餐'}
            {statusText ? ` · ${statusText}` : ''}
            {expiresAt ? ` · 到期 ${new Date(expiresAt).toLocaleDateString('zh-CN')}` : ''}
          </div>
        </div>
        {resetAt && <div className="rt-pcard-s">下次重置 {resetAt}</div>}
      </div>

      {planCredits && (
        <>
          <div className="rt-balance-row">
            <span className="rt-balance-lbl">套餐剩余</span>
            <span className="rt-balance-val">
              {planRemaining.toLocaleString('zh-CN')}{' '}
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                / {planCredits.total.toLocaleString('zh-CN')}
              </span>
            </span>
          </div>
          <div className="rt-balance-row">
            <span className="rt-balance-lbl">加油包积分</span>
            <span className="rt-balance-val rt-balance-val-gold">+{boosterCredits.toLocaleString('zh-CN')}</span>
          </div>
          <div className="rt-balance-row">
            <span className="rt-balance-lbl">本月消耗</span>
            <span className="rt-balance-val">{usedThisMonth.toLocaleString('zh-CN')}</span>
          </div>
          <div className="rt-balance-row" style={{ borderTop: '1px solid var(--border)' }}>
            <span className="rt-balance-lbl">本产品可用</span>
            <span className="rt-balance-val">{productCredits.toLocaleString('zh-CN')}</span>
          </div>
        </>
      )}

      {quotas.map((q, i) => {
        const pct = q.limit > 0 ? Math.min(100, (q.used / q.limit) * 100) : 0;
        const fillClass = pct >= 95 ? 'rt-quota-fill-error' : pct >= 80 ? 'rt-quota-fill-warn' : '';
        const windowName = q.windowType === 'ROLLING' ? '滚动' : q.windowType === 'FIXED_PERIOD' ? '周期' : '累计';
        return (
          <div key={i} className="rt-quota">
            <div className="rt-quota-row">
              <span>{q.durationLabel} {windowName}</span>
              <span>
                {q.used.toLocaleString('zh-CN')} / {q.limit.toLocaleString('zh-CN')} {metricLabel[q.metric]}
              </span>
            </div>
            <div className="rt-quota-bar">
              <div className={`rt-quota-fill ${fillClass}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}

      {keys.length > 0 && (
        <div className="rt-keys">
          <div className="rt-keys-h">API Key ({keys.length} 把)</div>
          {keys.map((k) => (
            <div key={k.id} className="rt-keys-row">
              <div>
                <div className="rt-keys-name">{k.prefix}</div>
                <div className="rt-keys-meta">{k.lastUsedAt ?? '未使用'} · {k.isActive ? '启用' : '停用'}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(onAddKey || onRenew || onAddQuota) && (
        <div className="rt-actions-row">
          {onAddKey && <Button onClick={onAddKey}>新建 Key</Button>}
          {onRenew && <Button onClick={onRenew}>续费</Button>}
          {onAddQuota && <Button onClick={onAddQuota}>手动加配额</Button>}
        </div>
      )}
    </div>
  );
}
