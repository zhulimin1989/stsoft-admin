import { useId } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

interface MetricChartProps<T> {
  data: T[];
  dataKey: keyof T & string;
  xKey?: keyof T & string;
  height?: number;
  color?: string;
}

export function MetricChart<T extends Record<string, unknown>>({
  data,
  dataKey,
  xKey = 'date' as keyof T & string,
  height = 200,
  color = '#002FA7',
}: MetricChartProps<T>) {
  const gradientId = useId().replace(/:/g, '');
  return (
    <div className="rt-chart" style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.18} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#F1ECE2" vertical={false} />
          <XAxis dataKey={xKey as string} tick={{ fontSize: 11, fill: '#8B94A3' }} />
          <YAxis tick={{ fontSize: 11, fill: '#8B94A3' }} />
          <Tooltip />
          <Area type="monotone" dataKey={dataKey as string} stroke={color} fill={`url(#${gradientId})`} strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
