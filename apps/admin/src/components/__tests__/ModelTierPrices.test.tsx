import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  ModelTierPrices,
  buildDisplayPriceTiers,
  effectivePriceForDraft,
  formatPriceTierRange,
} from '../ModelTierPrices';

/**
 * 分档价格展示的契约测试。
 *
 * 起因：「按量定价」页原先只显示"模型基价 × 倍率"一档，看不到时段档与长上下文档
 * （而「企业模型专属折扣」页已经能显示）。两页现在共用本组件渲染**同一份**后端契约，
 * 所以档序、缺失桶、草稿倍率、脏数据这几条都要有用例守住——否则两页又会显示不一致。
 */

const bucket = (input: number, cached: number | null, cacheWrite: number | null, output: number) => ({
  input, cached, cacheWrite, output,
});

describe('buildDisplayPriceTiers', () => {
  it('显式档在前、后备档在后（顺序即定价服务的选档顺序）', () => {
    const tiers = buildDisplayPriceTiers({
      tiers: [{
        tierKey: 'OFF_PEAK',
        displayName: '空闲时段价',
        minInputTokens: 0,
        maxInputTokensExclusive: null,
        base: bucket(1.5, 0.05, 0, 4.5),
        effective: bucket(1.35, 0.045, 0, 4.05),
      }],
      fallbackPricing: {
        longContext: null,
        default: { base: bucket(3, 0.1, 0, 9), effective: bucket(2.7, 0.09, 0, 8.1) },
      },
    });
    expect(tiers.map((t) => t.tierKey)).toEqual(['OFF_PEAK', 'fallback-default']);
    expect(tiers[0].title).toContain('空闲时段价');
    expect(tiers[1].title).toContain('默认后备价');
  });

  it('有长上下文档时插在默认后备价之前，且默认档标题说明"也未命中长上下文"', () => {
    const tiers = buildDisplayPriceTiers({
      tiers: [],
      fallbackPricing: {
        longContext: {
          minInputTokens: 128000,
          base: bucket(6, null, null, 18),
          effective: bucket(6, null, null, 18),
        },
        default: { base: bucket(3, null, null, 9), effective: bucket(3, null, null, 9) },
      },
    });
    expect(tiers.map((t) => t.tierKey)).toEqual(['fallback-long-context', 'fallback-default']);
    expect(tiers[0].title).toContain('128,000');
    expect(tiers[1].title).toContain('未命中长上下文价');
  });

  it('后端未返回档位（旧版本）时退回单档，不留空白', () => {
    const tiers = buildDisplayPriceTiers({
      base: bucket(1, null, null, 2),
      effective: bucket(0.9, null, null, 1.8),
    });
    expect(tiers).toHaveLength(1);
    expect(tiers[0].tierKey).toBe('legacy-base');
  });

  it('脏数据（后端置 tiers=[] 且 fallbackPricing=null）且无 base 时返回空 —— 由调用方降级展示', () => {
    expect(buildDisplayPriceTiers({ tiers: [], fallbackPricing: null })).toEqual([]);
  });
});

describe('effectivePriceForDraft', () => {
  it('倍率未改动 ⇒ 用后端算好的生效价（与计费同规则，不自行现算）', () => {
    expect(effectivePriceForDraft(3, 2.7, 0.9, 0.9)).toBe(2.7);
  });

  it('倍率改动 ⇒ 现算，并 round8（裸浮点乘会显示成 1.3499999999999999）', () => {
    expect(effectivePriceForDraft(1.5, 1.35, 0.9, 0.9000001)).toBe(1.35000015);
    // 典型浮点陷阱：0.1 * 3 === 0.30000000000000004
    expect(effectivePriceForDraft(0.1, null, 1, 3)).toBe(0.3);
  });

  it('基价缺失（未配置的缓存维度）⇒ null，不得当 0 参与计算', () => {
    expect(effectivePriceForDraft(null, 0, 1, 1)).toBeNull();
  });
});

describe('formatPriceTierRange', () => {
  it.each([
    [0, null, '全部 input tokens'],
    [0, 1000, 'input tokens < 1,000'],
    [1000, null, 'input tokens ≥ 1,000'],
    [1000, 2000, '1,000 ≤ input tokens < 2,000'],
  ])('min=%s max=%s ⇒ %s', (min, max, expected) => {
    expect(formatPriceTierRange(min, max as number | null)).toBe(expected);
  });
});

describe('ModelTierPrices 渲染', () => {
  it('每档四个维度都显示「标准价 → 生效价」，未配置桶显示占位而非 0', () => {
    render(
      <ModelTierPrices
        tiers={buildDisplayPriceTiers({
          tiers: [],
          fallbackPricing: {
            longContext: null,
            default: {
              base: bucket(0.2, null, null, 1),
              effective: bucket(0.18, null, null, 0.9),
            },
          },
        })}
        persistedMultiplier={0.9}
        draftMultiplier={0.9}
        currency="CNY"
        formatPrice={(v) => (v == null ? '— 未配置' : `¥${v}`)}
        effectiveHeader="生效价"
      />,
    );
    expect(screen.getByText('标准价')).toBeInTheDocument();
    expect(screen.getByText('生效价')).toBeInTheDocument();
    expect(screen.getByText('¥0.2')).toBeInTheDocument();
    expect(screen.getByText('¥0.18')).toBeInTheDocument();
    // 缓存读/写未配置：必须是占位，不能显示 ¥0（0 与"未配置"是两回事）
    expect(screen.getAllByText('— 未配置').length).toBeGreaterThanOrEqual(2);
  });

  it('列头文案可按页面切换（企业页叫「企业价」）', () => {
    render(
      <ModelTierPrices
        tiers={[{
          tierKey: 't', title: '档', base: bucket(1, null, null, 2), effective: bucket(1, null, null, 2),
        }]}
        persistedMultiplier={1}
        draftMultiplier={1}
        currency="CNY"
        formatPrice={(v) => (v == null ? '-' : `¥${v}`)}
        effectiveHeader="企业价"
      />,
    );
    expect(screen.getByText('企业价')).toBeInTheDocument();
  });
});
