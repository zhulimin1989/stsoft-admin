import { ReactNode } from 'react';
import './StatCard.css';

export type StatVariant = 'default' | 'success' | 'warning' | 'error';

interface DeltaProp {
  value: number;
  period?: string;
  trend?: 'up' | 'down' | 'flat';
  format?: 'number' | 'percent';
}

interface StatCardProps {
  label: string;
  value: number | string;
  delta?: DeltaProp;
  variant?: StatVariant;
  icon?: ReactNode;
}

function formatValue(v: number | string): string {
  if (typeof v === 'number') return v.toLocaleString('zh-CN');
  return v;
}

function deltaText(d: DeltaProp): string {
  const sign = d.trend === 'up' ? '↑ ' : d.trend === 'down' ? '↓ ' : '';
  const num = d.format === 'percent' ? `${d.value}%` : d.value.toLocaleString('zh-CN');
  const period = d.period ? ` (${d.period})` : '';
  return `${sign}${num}${period}`;
}

// Linear 化 KPI 形态:label + 数值 + delta,不再渲染图标方块。
// icon prop 保留以兼容现有调用方,仅不再展示。
export function StatCard({ label, value, delta, variant = 'default' }: StatCardProps) {
  const valueClass = `rt-stat-value rt-stat-value-${variant}`;
  return (
    <div className="rt-stat" data-variant={variant}>
      <div className="rt-stat-label">{label}</div>
      <div className={valueClass}>{formatValue(value)}</div>
      {delta && (
        <div className={`rt-stat-delta rt-stat-delta-${delta.trend ?? 'flat'}`}>
          {deltaText(delta)}
        </div>
      )}
    </div>
  );
}

interface StatCardGroupProps {
  columns?: number;
  children: ReactNode;
}

export function StatCardGroup({ columns = 4, children }: StatCardGroupProps) {
  return (
    <div className="rt-stat-group" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
      {children}
    </div>
  );
}
