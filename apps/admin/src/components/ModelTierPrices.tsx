import { Fragment } from 'react';
import { Space } from 'antd';

/**
 * 模型分档价格展示（「基价 → 生效价」）。
 *
 * 抽出来共享的原因：「企业模型专属折扣」页早已实现并验证了这套分档展示，
 * 而「按量定价」页当时只显示单一基准价 × 倍率、看不到时段档与长上下文档。
 * 两边渲染同一份后端契约（`tiers[]` + `fallbackPricing`），共用一份实现即可，
 * 不必各写一套——各写一套就会出现"同一批价格在两个页面显示不一致"。
 *
 * 为什么必须显示基价：倍率作用在**哪个基数**上决定实际扣费。只给生效价，
 * 运营无法判断这个价是从模型基价来的还是从某个档价来的，而两者基数不同。
 */

export type ModelPriceBucket = {
  input: number | null;
  cached: number | null;
  cacheWrite: number | null;
  output: number | null;
};

export type ModelPriceTierInput = {
  tierKey: string;
  displayName?: string | null;
  minInputTokens: number;
  maxInputTokensExclusive?: number | null;
  base: ModelPriceBucket;
  effective: ModelPriceBucket;
};

export type ModelFallbackPricingInput = {
  default: { base: ModelPriceBucket; effective: ModelPriceBucket };
  longContext:
    | null
    | { minInputTokens: number; base: ModelPriceBucket; effective: ModelPriceBucket };
};

export type ModelDisplayPriceTier = {
  tierKey: string;
  title: string;
  base: ModelPriceBucket;
  effective: ModelPriceBucket;
};

export const MODEL_PRICE_PARTS: Array<{ key: keyof ModelPriceBucket; label: string }> = [
  { key: 'input', label: '输入' },
  { key: 'cached', label: '缓存读' },
  { key: 'cacheWrite', label: '缓存写' },
  { key: 'output', label: '输出' },
];

function formatTokenBoundary(value: number): string {
  return Math.max(0, Math.floor(value)).toLocaleString('en-US');
}

export function formatPriceTierRange(
  minInputTokens: number,
  maxInputTokensExclusive?: number | null,
): string {
  const min = Math.max(0, Math.floor(minInputTokens));
  if (min === 0 && maxInputTokensExclusive == null) return '全部 input tokens';
  if (min === 0) return `input tokens < ${formatTokenBoundary(maxInputTokensExclusive!)}`;
  if (maxInputTokensExclusive == null) return `input tokens ≥ ${formatTokenBoundary(min)}`;
  return `${formatTokenBoundary(min)} ≤ input tokens < ${formatTokenBoundary(maxInputTokensExclusive)}`;
}

function priceTierTitle(tier: ModelPriceTierInput): string {
  const range = formatPriceTierRange(tier.minInputTokens, tier.maxInputTokensExclusive);
  const displayName = tier.displayName?.trim();
  return displayName ? `${displayName} · ${range}` : range;
}

/**
 * 把后端契约展开成"要显示的档列表"：显式档在前，后备档在后。
 * 顺序即定价服务的**选档顺序**——显式档优先，未命中才落到长上下文/默认后备价。
 */
export function buildDisplayPriceTiers(source: {
  tiers?: ModelPriceTierInput[] | null;
  fallbackPricing?: ModelFallbackPricingInput | null;
  base?: ModelPriceBucket;
  effective?: ModelPriceBucket | null;
}): ModelDisplayPriceTier[] {
  const explicitTiers = (source.tiers ?? []).map((tier) => ({
    tierKey: tier.tierKey,
    title: priceTierTitle(tier),
    base: tier.base,
    effective: tier.effective,
  }));

  const fallbackPricing = source.fallbackPricing;
  if (fallbackPricing) {
    const fallbackTiers: ModelDisplayPriceTier[] = [];
    if (fallbackPricing.longContext) {
      fallbackTiers.push({
        tierKey: 'fallback-long-context',
        title: `长上下文后备价 · 未命中显式价格档且 input tokens ≥ ${formatTokenBoundary(fallbackPricing.longContext.minInputTokens)}`,
        base: fallbackPricing.longContext.base,
        effective: fallbackPricing.longContext.effective,
      });
    }
    fallbackTiers.push({
      tierKey: 'fallback-default',
      title: fallbackPricing.longContext
        ? '默认后备价 · 未命中显式价格档且未命中长上下文价'
        : '默认后备价 · 未命中显式价格档',
      base: fallbackPricing.default.base,
      effective: fallbackPricing.default.effective,
    });
    return [...explicitTiers, ...fallbackTiers];
  }

  if (explicitTiers.length > 0) return explicitTiers;
  // 后端未返回档位数据（旧版本）时退回单档展示，不留空白。
  if (source.base) {
    return [{
      tierKey: 'legacy-base',
      title: '默认价（未返回价格档）',
      base: source.base,
      effective: source.effective ?? source.base,
    }];
  }
  return [];
}

/**
 * 草稿倍率下的生效价：倍率与已保存值一致时用后端算好的生效价（与计费同规则），
 * 改动后才用 `基价 × 草稿倍率` 现算，让运营保存前就能看到该档会变成多少。
 */
export function effectivePriceForDraft(
  basePrice: number | null,
  persistedEffectivePrice: number | null,
  persistedMultiplier: number,
  draftMultiplier: number,
): number | null {
  if (basePrice == null) return null;
  if (
    Number.isFinite(persistedEffectivePrice)
    && Math.abs(draftMultiplier - persistedMultiplier) < 1e-12
  ) {
    return persistedEffectivePrice;
  }
  // round8 与 billing 侧 multiplyPrice 的口径一致：裸浮点乘会显示成
  // 1.3499999999999999 这种值，运营会以为是精度异常。
  return Number((basePrice * draftMultiplier).toFixed(8));
}

export function ModelTierPrices({
  tiers,
  persistedMultiplier,
  draftMultiplier,
  currency,
  formatPrice,
  ariaLabel,
  testIdPrefix,
  effectiveHeader = '生效价',
}: {
  tiers: ModelDisplayPriceTier[];
  persistedMultiplier: number;
  draftMultiplier: number;
  currency: string;
  formatPrice: (value: number | null, currency: string) => string;
  ariaLabel?: string;
  testIdPrefix?: string;
  /** 企业折扣页叫「企业价」，按量定价页叫「生效价」。 */
  effectiveHeader?: string;
}) {
  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }} aria-label={ariaLabel}>
      {tiers.map((tier) => (
        <div
          key={tier.tierKey}
          data-testid={testIdPrefix ? `${testIdPrefix}-${tier.tierKey}` : undefined}
          style={{
            border: '1px solid #edf0f4',
            borderRadius: 6,
            padding: '8px 10px',
            background: '#fafbfc',
          }}
        >
          <div style={{ color: '#536075', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>
            {tier.title}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '58px minmax(80px, 1fr) 16px minmax(80px, 1fr)',
              columnGap: 6,
              rowGap: 3,
              alignItems: 'center',
              fontSize: 12,
            }}
          >
            <span style={{ color: '#8c98a8' }}>类型</span>
            <span style={{ color: '#8c98a8' }}>标准价</span>
            <span />
            <span style={{ color: '#8c98a8' }}>{effectiveHeader}</span>
            {MODEL_PRICE_PARTS.map((part) => {
              const basePrice = tier.base[part.key];
              const effective = effectivePriceForDraft(
                basePrice,
                tier.effective[part.key],
                persistedMultiplier,
                draftMultiplier,
              );
              return (
                <Fragment key={part.key}>
                  <span>{part.label}</span>
                  <span>{formatPrice(basePrice, currency)}</span>
                  <span style={{ color: '#a6afbd' }}>→</span>
                  <span>{formatPrice(effective, currency)}</span>
                </Fragment>
              );
            })}
          </div>
        </div>
      ))}
    </Space>
  );
}
