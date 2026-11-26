interface FunnelStep {
  label: string;
  value: number;
  prevValue?: number;
}

interface FunnelChartProps {
  steps: FunnelStep[];
}

export function FunnelChart({ steps }: FunnelChartProps) {
  const max = Math.max(...steps.map((s) => s.value), 1);
  const count = steps.length;
  return (
    <div className="rt-funnel">
      {steps.map((s, i) => {
        const widthPct = (s.value / max) * 100;
        const conversionPct =
          i > 0 && steps[i - 1].value > 0
            ? ((s.value / steps[i - 1].value) * 100).toFixed(1)
            : null;
        // 透明度梯度表达漏斗衰减:首段最深,逐段变浅。
        // 大面积色块降饱和,克莱因蓝实底只留给按钮等小面积 accent。
        const alpha = count > 1 ? 0.85 - (i / (count - 1)) * 0.55 : 0.85;
        return (
          <div key={i} className="rt-funnel-row">
            <div className="rt-funnel-label">{s.label}</div>
            <div className="rt-funnel-track">
              <div
                className="rt-funnel-bar"
                style={{ width: `${widthPct}%`, background: `rgba(0, 47, 167, ${alpha.toFixed(2)})` }}
              >
                <span className="rt-funnel-meta">
                  <span className="rt-funnel-value">{s.value.toLocaleString('zh-CN')}</span>
                  <span className="rt-funnel-conv">{conversionPct ? `${conversionPct}%` : '—'}</span>
                </span>
              </div>
            </div>
          </div>
        );
      })}
      <style>{`
        .rt-funnel { padding: 4px 0 2px; }
        .rt-funnel-row { display: grid; grid-template-columns: 88px 1fr; align-items: center; gap: 12px; padding: 5px 0; }
        .rt-funnel-label { font-size: var(--fs-sm); color: var(--text-secondary); }
        /* 右侧预留数值区,数值始终紧贴条尾 */
        .rt-funnel-track { position: relative; background: rgba(0, 47, 167, 0.05); border-radius: 4px; height: 22px; margin-right: 116px; }
        .rt-funnel-bar { position: relative; height: 100%; border-radius: 4px; min-width: 2px; transition: width 0.3s; }
        .rt-funnel-meta {
          position: absolute;
          left: 100%;
          top: 50%;
          transform: translateY(-50%);
          margin-left: 9px;
          display: inline-flex;
          align-items: baseline;
          gap: 7px;
          white-space: nowrap;
        }
        .rt-funnel-value { color: var(--text); font-size: var(--fs-sm); font-weight: 600; font-variant-numeric: tabular-nums; }
        .rt-funnel-conv { color: var(--text-muted); font-size: var(--fs-xs); font-variant-numeric: tabular-nums; }
      `}</style>
    </div>
  );
}
