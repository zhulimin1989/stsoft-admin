import { Button } from 'antd';
import { Tag } from '../../components/common';
import './cards.css';

interface Props {
  productName: string;
  planName?: string;
  status?: string;
  expiresAt?: string | null;
  remainingDays?: number;
  planCredits: { used: number; total: number };
  boosterCredits: number;
  usedThisMonth?: number;
  onRenew?: () => void;
  onBuyBooster?: () => void;
  onAddCredits?: () => void;
}

const statusLabel: Record<string, string> = {
  ACTIVE: '生效中',
  EXPIRED: '已过期',
  CANCELLED: '已取消',
};

export function SubscriptionCard({
  productName,
  planName,
  status,
  expiresAt,
  remainingDays,
  planCredits,
  boosterCredits,
  usedThisMonth = 0,
  onRenew,
  onBuyBooster,
  onAddCredits,
}: Props) {
  const planRemaining = Math.max(0, planCredits.total - planCredits.used);
  const total = planRemaining + boosterCredits;
  const statusText = status ? statusLabel[status] ?? status : undefined;

  return (
    <div className="rt-pcard">
      <div className="rt-pcard-h">
        <div>
          <div className="rt-pcard-t">{productName} <Tag variant="muted">订阅</Tag></div>
          <div className="rt-pcard-meta">
            {planName ?? '未绑定套餐'}
            {statusText ? ` · ${statusText}` : ''}
            {expiresAt ? ` · 到期 ${new Date(expiresAt).toLocaleDateString('zh-CN')}` : ''}
          </div>
        </div>
        {remainingDays !== undefined && <div className="rt-pcard-s">本期剩余 {remainingDays} 天</div>}
      </div>

      <div className="rt-balance-row">
        <span className="rt-balance-lbl">套餐剩余</span>
        <span className="rt-balance-val">
          {planRemaining.toLocaleString('zh-CN')}{' '}
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>/ {planCredits.total.toLocaleString('zh-CN')}</span>
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
        <span className="rt-balance-val">{total.toLocaleString('zh-CN')}</span>
      </div>

      {(onRenew || onBuyBooster || onAddCredits) && (
        <div className="rt-actions-row">
          {onRenew && <Button onClick={onRenew}>续费</Button>}
          {onBuyBooster && <Button onClick={onBuyBooster}>买加油包</Button>}
          {onAddCredits && <Button onClick={onAddCredits}>手动加积分</Button>}
        </div>
      )}
    </div>
  );
}
