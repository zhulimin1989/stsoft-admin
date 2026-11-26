/**
 * ProviderLogo — 模型厂商 logo（内联 SVG，避免外链/打包体积大）。
 *
 * 用法：<ProviderLogo provider="openai" size={28} />
 *
 * 未识别的 provider 会回退到首字母圆形徽标。SVG 路径取自 simple-icons/lobe-icons
 * 公开版本，统一用 currentColor 让色彩跟随 CSS color，便于深浅主题。
 */

import type { CSSProperties } from 'react';

interface Props {
  provider?: string | null;
  modelName?: string;
  size?: number;
  style?: CSSProperties;
}

interface Brand {
  // SVG path data (viewBox 24x24)
  path: string;
  bg: string;
  fg: string;
}

const MOONSHOT_BRAND: Brand = {
  bg: '#000',
  fg: '#fff',
  path: 'M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 2a8 8 0 0 1 7.412 4.989 5.5 5.5 0 0 0-9.787 5.014A5.5 5.5 0 0 0 19.93 13.4 8 8 0 1 1 12 4z',
};

// Color palette — keep close to brand guidelines.
const BRANDS: Record<string, Brand> = {
  openai: {
    bg: '#000',
    fg: '#fff',
    path: 'M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z',
  },
  anthropic: {
    bg: '#D97757',
    fg: '#fff',
    path: 'M14.137 6h-2.95l5.36 12h2.95L14.138 6zm-7.225 0L1.55 18h3.013l1.085-2.794h5.598L12.337 18h3.013L9.985 6H6.91zm-.41 7.077L8.4 8.34l1.91 4.737H6.5z',
  },
  google: {
    bg: '#fff',
    fg: '#4285F4',
    // Multi-color "G" — use 4 paths via a special render below
    path: '__google__',
  },
  deepseek: {
    bg: '#4D6BFE',
    fg: '#fff',
    path: 'M23.748 4.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.547-.352-.156-.708-.311-.954-.65-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.198-.031-.276.136-.354.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.218-.329.14a5.526 5.526 0 0 1-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11.365 11.365 0 0 0-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428-.872.004-1.67.295-2.687.684a3.055 3.055 0 0 1-.465.137 9.597 9.597 0 0 0-2.883-.102c-1.885.21-3.39 1.102-4.497 2.623C.082 8.606-.231 10.684.152 12.85c.403 2.284 1.569 4.175 3.36 5.653 1.858 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.133-.284 4.994-1.86.47.234.962.327 1.78.397.63.059 1.236-.03 1.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926 1.096-1.296 2.746-2.642 3.392-7.003.05-.347.007-.565 0-.845-.004-.17.035-.237.23-.256a4.173 4.173 0 0 0 1.545-.475c1.396-.763 1.96-2.015 2.093-3.517.02-.23-.004-.467-.247-.588zM11.581 18c-2.089-1.642-3.102-2.183-3.52-2.16-.392.024-.321.471-.235.763.09.288.207.486.371.739.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.167-1.361-.802-2.5-1.86-3.301-3.307-.774-1.393-1.224-2.887-1.298-4.482-.02-.386.093-.522.477-.592a4.696 4.696 0 0 1 1.529-.039c2.132.312 3.946 1.265 5.468 2.774.868.86 1.525 1.887 2.202 2.891.72 1.066 1.494 2.082 2.48 2.914.348.292.625.514.891.677-.802.09-2.14.11-3.054-.614zm1-6.44a.306.306 0 0 1 .415-.287.302.302 0 0 1 .2.288.306.306 0 0 1-.31.307.303.303 0 0 1-.304-.308zm3.11 1.596c-.2.081-.399.151-.59.16a1.245 1.245 0 0 1-.798-.254c-.274-.23-.47-.358-.552-.758a1.73 1.73 0 0 1 .016-.588c.07-.327-.008-.537-.239-.727-.187-.156-.426-.199-.688-.199a.559.559 0 0 1-.254-.078c-.11-.054-.2-.19-.114-.358.028-.054.16-.186.192-.21.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.391.451.462.576.685.914.176.265.336.537.445.848.067.195-.019.354-.25.452z',
  },
  zhipu: {
    bg: '#3859FF',
    fg: '#fff',
    path: 'M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.236l7.764 3.882L12 12 4.236 8.118 12 4.236zM4 9.618l7 3.5v7.764l-7-3.5V9.618zm9 11.264v-7.764l7-3.5v7.764l-7 3.5z',
  },
  moonshot: MOONSHOT_BRAND,
  kimi: MOONSHOT_BRAND,
  minimax: {
    bg: '#F23F5D',
    fg: '#fff',
    path: 'M3 4h2.5l3 9 3-9H14v16h-2V8.5L9 17H8L5 8.5V20H3V4zm14 0h2v16h-2V4z',
  },
  qwen: {
    bg: '#615CED',
    fg: '#fff',
    path: 'M12.604 1.34l9.144 5.39a.85.85 0 0 1 .305.31l1.181 2.107a.85.85 0 0 1-.005.844l-1.39 2.358-1.444 2.466 1.41 2.376a.85.85 0 0 1 .005.864l-1.196 2.087a.85.85 0 0 1-.298.318l-9.111 5.43a.85.85 0 0 1-.868 0l-9.144-5.39a.85.85 0 0 1-.305-.31l-1.181-2.107a.85.85 0 0 1 .005-.844l1.39-2.358 1.444-2.466-1.41-2.376a.85.85 0 0 1-.005-.864l1.196-2.087a.85.85 0 0 1 .298-.318l9.111-5.43a.85.85 0 0 1 .868 0z',
  },
  mistral: {
    bg: '#FA520F',
    fg: '#fff',
    path: 'M3 3h4v4H3V3zm14 0h4v4h-4V3zM3 7h4v4H3V7zm0 4h4v4H3v-4zm0 4h4v4H3v-4zm14-8h4v4h-4V7zm0 4h4v4h-4v-4zm0 4h4v4h-4v-4zm-7-4h4v4h-4v-4z',
  },
  meta: {
    bg: '#0866FF',
    fg: '#fff',
    path: 'M12 2C6.48 2 2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V14H8v-2h2V9.5C10 7.57 11.57 6 13.5 6H16v2h-2c-.55 0-1 .45-1 1v3h3v2h-3v7.95c5.05-.5 9-4.76 9-9.95 0-5.52-4.48-10-10-10z',
  },
};

// Inference: detect provider from name when prop missing.
function inferProvider(name?: string): string | undefined {
  if (!name) return undefined;
  const n = name.toLowerCase();
  if (n.startsWith('gpt') || n.startsWith('o1') || n.startsWith('o3') || n.includes('openai')) return 'openai';
  if (n.startsWith('claude') || n.includes('anthropic') || n.includes('sonnet') || n.includes('opus') || n.includes('haiku')) return 'anthropic';
  if (n.startsWith('gemini') || n.includes('palm') || n.includes('bison')) return 'google';
  if (n.startsWith('deepseek')) return 'deepseek';
  if (n.startsWith('glm') || n.includes('chatglm') || n.includes('zhipu')) return 'zhipu';
  if (n.startsWith('kimi') || n.includes('moonshot')) return 'moonshot';
  if (n.includes('minimax') || n.startsWith('abab')) return 'minimax';
  if (n.startsWith('qwen') || n.includes('tongyi')) return 'qwen';
  if (n.startsWith('mistral') || n.startsWith('mixtral') || n.startsWith('codestral')) return 'mistral';
  if (n.startsWith('llama') || n.startsWith('meta-llama')) return 'meta';
  return undefined;
}

export function ProviderLogo({ provider, modelName, size = 28, style }: Props) {
  const key = (provider ?? inferProvider(modelName) ?? '').toLowerCase();
  const brand = BRANDS[key];

  const baseStyle: CSSProperties = {
    width: size,
    height: size,
    borderRadius: 6,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...style,
  };

  if (!brand) {
    // Fallback: subtle initial badge — quiet enough to not distract.
    const initial = (provider ?? modelName ?? '?').slice(0, 1).toUpperCase();
    return (
      <div
        style={{
          ...baseStyle,
          background: '#f3f4f6',
          color: '#6b7280',
          fontSize: size * 0.48,
          fontWeight: 600,
        }}
      >
        {initial}
      </div>
    );
  }

  // Google's G is 4-color — render explicitly instead of single path.
  if (brand.path === '__google__') {
    return (
      <div style={{ ...baseStyle, background: brand.bg, padding: size * 0.14 }}>
        <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" fill="#34A853" />
          <path d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18A11 11 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.83z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z" fill="#EA4335" />
        </svg>
      </div>
    );
  }

  return (
    <div style={{ ...baseStyle, background: brand.bg, color: brand.fg }}>
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="currentColor" aria-hidden>
        <path d={brand.path} />
      </svg>
    </div>
  );
}

export default ProviderLogo;
