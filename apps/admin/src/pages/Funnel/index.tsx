import { useEffect, useState } from 'react';
import { Select, message } from 'antd';
import {
  PageHeader,
  EmptyPlaceholder,
  FunnelChart,
} from '../../components/common';
import {
  funnelApi,
  userSegmentApi,
  type FunnelData,
  type UserSegment,
} from '../../api/v2';

const DAYS_OPTIONS = [
  { value: 7, label: '近 7 天' },
  { value: 30, label: '近 30 天' },
  { value: 90, label: '近 90 天' },
];

const STUB_TODOS = [
  'funnel 聚合接口(注册/激活/付费/续订事件流)',
  '分群粒度的 funnel',
  '订阅 vs 按量 双漏斗对比',
];

interface FunnelStep {
  label: string;
  value: number;
  prevValue?: number;
}

function dataToSteps(data: FunnelData | null): FunnelStep[] {
  if (!data) return [];
  return data.steps.map((s, i) => ({
    label: s.label,
    value: s.value,
    prevValue: i > 0 ? data.steps[i - 1].value : undefined,
  }));
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border-divider)',
  borderRadius: 'var(--radius-card)',
  padding: 16,
};

const cardHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 12,
  minHeight: 30,
};

const cardTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text)',
};

// 自适应两栏:>=2 卡且容器够宽时双列,窄屏自动回落单列
const twoColGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))',
  gap: 16,
  marginBottom: 16,
};

export default function FunnelPage() {
  const [days, setDays] = useState<number>(30);
  const [stubMode, setStubMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [main, setMain] = useState<FunnelData | null>(null);
  const [segmentMain, setSegmentMain] = useState<FunnelData | null>(null);
  const [segments, setSegments] = useState<UserSegment[]>([]);
  const [segmentId, setSegmentId] = useState<string | undefined>(undefined);
  const [subscription, setSubscription] = useState<FunnelData | null>(null);
  const [payg, setPayg] = useState<FunnelData | null>(null);

  const fetchAll = async (opts: { days: number; segmentId?: string }) => {
    setLoading(true);
    try {
      const [m, sub, pg] = await Promise.all([
        funnelApi.getFunnel({ days: opts.days }),
        funnelApi.getSubscriptionFunnel({ days: opts.days }),
        funnelApi.getPaygFunnel({ days: opts.days }),
      ]);
      setMain(m);
      setSubscription(sub);
      setPayg(pg);
      setStubMode(false);

      if (opts.segmentId) {
        try {
          const seg = await funnelApi.getFunnel({
            days: opts.days,
            segmentId: opts.segmentId,
          });
          setSegmentMain(seg);
        } catch {
          setSegmentMain(null);
        }
      } else {
        setSegmentMain(null);
      }
    } catch (err: unknown) {
      const code = (err as { response?: { status?: number } })?.response
        ?.status;
      if (code === 404) {
        setStubMode(true);
        setMain(null);
        setSubscription(null);
        setPayg(null);
        setSegmentMain(null);
      } else {
        message.error('加载漏斗数据失败');
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchSegments = async () => {
    try {
      const res = await userSegmentApi.list({ pageSize: 50, isActive: true });
      setSegments(res.items ?? []);
    } catch {
      setSegments([]);
    }
  };

  useEffect(() => {
    fetchSegments();
  }, []);

  useEffect(() => {
    fetchAll({ days, segmentId });
  }, [days, segmentId]);

  return (
    <div style={{ maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader
        title="业务漏斗"
        subtitle="用户从注册到续订的转化率追踪"
        actions={
          stubMode
            ? []
            : [
                <Select
                  key="days"
                  value={days}
                  style={{ width: 120 }}
                  onChange={(v) => setDays(v)}
                  options={DAYS_OPTIONS}
                />,
              ]
        }
      />

      {stubMode ? (
        <EmptyPlaceholder
          title="后端接口待就绪"
          description="业务漏斗后端 API 尚未上线,无法 derive。"
          todos={STUB_TODOS}
        />
      ) : (
        <>
          <div style={twoColGrid}>
            <div style={cardStyle}>
              <div style={cardHeader}>
                <div style={cardTitle}>主漏斗</div>
              </div>
              {loading ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                  加载中...
                </div>
              ) : main && main.steps.length > 0 ? (
                <FunnelChart steps={dataToSteps(main)} />
              ) : (
                <EmptyPlaceholder
                  title="暂无主漏斗数据"
                  description="该时间区间内没有事件流数据。"
                />
              )}
            </div>

            <div style={cardStyle}>
              <div style={cardHeader}>
                <div style={cardTitle}>分群分析</div>
                <Select
                  placeholder="选择分群查看转化"
                  style={{ width: 240 }}
                  allowClear
                  value={segmentId}
                  onChange={(v) => setSegmentId(v)}
                  options={segments.map((s) => ({ value: s.id, label: s.name }))}
                />
              </div>
              {!segmentId ? (
                <EmptyPlaceholder
                  title="选择一个分群"
                  description="在右上方选择分群以查看其漏斗。"
                />
              ) : segmentMain && segmentMain.steps.length > 0 ? (
                <FunnelChart steps={dataToSteps(segmentMain)} />
              ) : (
                <EmptyPlaceholder
                  title="暂无该分群漏斗数据"
                  description="可能后端尚未支持分群粒度漏斗。"
                  todos={['分群粒度的 funnel 聚合']}
                />
              )}
            </div>
          </div>

          <div style={{ ...twoColGrid, marginBottom: 0 }}>
            <div style={cardStyle}>
              <div style={cardHeader}>
                <div style={cardTitle}>订阅漏斗</div>
              </div>
              {subscription && subscription.steps.length > 0 ? (
                <FunnelChart steps={dataToSteps(subscription)} />
              ) : (
                <EmptyPlaceholder
                  title="暂无订阅漏斗"
                  description="订阅事件流尚未聚合。"
                />
              )}
            </div>
            <div style={cardStyle}>
              <div style={cardHeader}>
                <div style={cardTitle}>按量漏斗</div>
              </div>
              {payg && payg.steps.length > 0 ? (
                <FunnelChart steps={dataToSteps(payg)} />
              ) : (
                <EmptyPlaceholder
                  title="暂无按量漏斗"
                  description="按量事件流尚未聚合。"
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
