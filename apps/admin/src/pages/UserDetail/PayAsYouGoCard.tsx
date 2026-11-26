import { Button } from 'antd';
import { Tag } from '../../components/common';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { formatCurrencyCents } from '../../utils/price';
import './cards.css';

interface KeyRow {
  id: string;
  prefix: string;
  lastUsedAt?: string;
  isActive: boolean;
  monthUsageCents: number;
}

interface Props {
  productName: string;
  planName?: string;
  status?: string;
  expiresAt?: string | null;
  balanceCents: number;
  monthUsageCents?: number;
  keys?: KeyRow[];
  onAddKey?: () => void;
  onRecharge?: () => void;
  onAdjustBalance?: () => void;
}

const statusLabel: Record<string, string> = {
  ACTIVE: '生效中',
  EXPIRED: '已过期',
  CANCELLED: '已取消',
};

export function PayAsYouGoCard({
  productName,
  planName,
  status,
  expiresAt,
  balanceCents,
  monthUsageCents,
  keys = [],
  onAddKey,
  onRecharge,
  onAdjustBalance,
}: Props) {
  const platformCurrency = usePlatformCurrency();
  const formatMoney = (cents: number) => formatCurrencyCents(cents, platformCurrency);
  const statusText = status ? statusLabel[status] ?? status : undefined;
  const metricColumns = monthUsageCents === undefined ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)';

  return (
    <div className="rt-pcard">
      <div className="rt-pcard-h">
        <div>
          <div className="rt-pcard-t">{productName} <Tag variant="muted">按量付费</Tag></div>
          <div className="rt-pcard-meta">
            {planName ?? '账号钱包计费'}
            {statusText ? ` · ${statusText}` : ''}
            {expiresAt ? ` · 到期 ${new Date(expiresAt).toLocaleDateString('zh-CN')}` : ''}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: metricColumns, gap: 14, marginTop: 6 }}>
        <div className="rt-balance-row" style={{ borderTop: 'none', padding: 0 }}>
          <span className="rt-balance-lbl">账号钱包余额</span>
          <span className="rt-balance-val">{formatMoney(balanceCents)}</span>
        </div>
        {monthUsageCents !== undefined && (
          <div className="rt-balance-row" style={{ borderTop: 'none', padding: 0 }}>
            <span className="rt-balance-lbl">本月用量</span>
            <span className="rt-balance-val">{formatMoney(monthUsageCents)}</span>
          </div>
        )}
        <div className="rt-balance-row" style={{ borderTop: 'none', padding: 0 }}>
          <span className="rt-balance-lbl">订阅状态</span>
          <span className="rt-balance-val">{statusText ?? '—'}</span>
        </div>
      </div>

      {keys.length > 0 && (
        <div className="rt-keys">
          <div className="rt-keys-h">API Key ({keys.length} 把)</div>
          {keys.map((k) => (
            <div key={k.id} className="rt-keys-row">
              <div>
                <div className="rt-keys-name">{k.prefix}</div>
                <div className="rt-keys-meta">
                  {k.lastUsedAt ?? '未使用'} · {k.isActive ? '启用' : '停用'} · 本月 {formatMoney(k.monthUsageCents)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(onAddKey || onRecharge || onAdjustBalance) && (
        <div className="rt-actions-row">
          {onAddKey && <Button onClick={onAddKey}>新建 Key</Button>}
          {onRecharge && <Button onClick={onRecharge}>充值</Button>}
          {onAdjustBalance && <Button onClick={onAdjustBalance}>手动调余额</Button>}
        </div>
      )}
    </div>
  );
}
