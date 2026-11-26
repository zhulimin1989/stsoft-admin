// Raytone Admin Theme — Linear 化改版(纸色底 + 克莱因蓝 IKB accent)
// 2026-06: 与 codesphere-frontend-saas 解除镜像,admin 独立维护。
// C 端(saas)保持 Raytone 深海蓝体系;admin 后台走本主题,两者只共享纸色底。
export const theme = {
  colors: {
    // Primary — 克莱因蓝 IKB
    primary: '#002FA7',
    primaryHover: '#0E3CB5',
    primaryDark: '#0A0F1A',
    primaryLight: 'rgba(0, 47, 167, 0.06)',
    secondary: '#4A7FA5',
    accent: '#002FA7',
    honey: '#E8B464',
    mist: '#F5F2EC',
    paper: '#FCFBF8',
    stone400: '#C9CDD3',
    stone600: '#6B7280',
    stone800: '#2A2F3A',
    ink: '#0A0F1A',

    // Legacy teal aliases mapped to admin neutrals/primary
    teal50: '#FCFBF8',
    teal100: '#F5F2EC',
    teal200: '#E5DFD3',
    teal300: '#C9CDD3',
    teal400: '#4A7FA5',
    teal500: '#002FA7',
    teal600: '#002FA7',
    teal700: '#0A0F1A',

    // Gray 色阶
    gray50: '#FAFAF7',
    gray100: '#F5F2EC',
    gray200: '#E7E1D7',
    gray300: '#C9CDD3',
    gray400: '#8B94A3',
    gray500: '#6B7280',
    gray600: '#4F5867',
    gray900: '#0A0F1A',

    // Gray 扩展色阶
    gray700: '#394150',
    gray800: '#2A2F3A',

    // Amber 色阶
    amber50: 'rgba(232, 180, 100, 0.14)',
    amber500: '#E8B464',
    amber600: '#D98A3D',

    // Blue 色阶
    blue50: 'rgba(74, 127, 165, 0.12)',
    blue500: '#4A7FA5',

    // 背景色
    background: 'transparent',
    bgBody: '#F5F2EC',
    bgPanel: '#FCFBF8',
    bgHover: 'rgba(0, 47, 167, 0.045)',
    bgActive: 'rgba(0, 47, 167, 0.08)',

    // 文字色
    text: '#2A2F3A',
    textPrimary: '#2A2F3A',
    textSecondary: '#6B7280',
    textMuted: '#8B94A3',

    // 边框色
    border: '#C9CDD3',
    borderHover: '#002FA7',

    // 状态色
    success: '#4A9B7F',
    warning: '#D98A3D',
    warningBg: 'rgba(232, 180, 100, 0.14)',
    warningBorder: 'rgba(217, 138, 61, 0.28)',
    warningText: '#8A5726',
    error: '#C85A54',
    errorDark: '#A94742',
    info: '#4A7FA5',
    browserDotRed: '#ff5f56',
    browserDotYellow: '#ffbd2e',
    browserDotGreen: '#27c93f',

    // 工具类型色
    toolMcp: '#002FA7',
    toolSkill: '#4A7FA5',
    toolAgent: '#E8B464',
    toolPlugin: '#4A9B7F',
    toolCommand: '#0A0F1A',

    // Surfaces
    glassBg: 'rgba(252, 251, 248, 0.94)',
    glassLight: 'rgba(252, 251, 248, 0.98)',
    glassLighter: '#FCFBF8',
    glassBorder: '#C9CDD3',
    glassInnerBorder: 'rgba(0, 47, 167, 0.04)',

    // Klein blue alpha variants
    primaryAlpha06: 'rgba(0, 47, 167, 0.06)',
    primaryAlpha08: 'rgba(0, 47, 167, 0.08)',
    primaryAlpha10: 'rgba(0, 47, 167, 0.10)',
    primaryAlpha15: 'rgba(0, 47, 167, 0.15)',
    primaryAlpha20: 'rgba(0, 47, 167, 0.20)',
    primaryAlpha35: 'rgba(0, 47, 167, 0.35)',

    auroraGlow: 'rgba(0, 47, 167, 0.18)',
    auroraGlowLight: 'rgba(0, 47, 167, 0.05)',

  },

  fonts: {
    heading: "'Geist', 'Inter', -apple-system, BlinkMacSystemFont, 'Source Han Sans SC', sans-serif",
    sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Source Han Sans SC', 'PingFang SC', sans-serif",
    mono: "'JetBrains Mono', 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  },

  fontSizes: {
    xs: '0.65rem',
    sm: '0.75rem',
    base: '0.85rem',
    md: '0.9rem',
    lg: '1rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
    '3xl': '2rem',
  },

  spacing: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
    '2xl': '32px',
    '3xl': '48px',
  },

  borderRadius: {
    sm: '4px',
    md: '4px',
    lg: '8px',
    xl: '16px',
    full: '9999px',
  },

  shadows: {
    // Linear 化:卡片层不再用投影(靠 1px 边框),阴影仅保留给浮层(dropdown/modal)
    sm: '0 1px 2px rgba(20, 24, 40, 0.04)',
    md: '0 4px 16px rgba(20, 24, 40, 0.08)',
    lg: '0 8px 28px rgba(20, 24, 40, 0.10)',
    xl: '0 16px 48px rgba(20, 24, 40, 0.14)',
  },

  transitions: {
    fast: '0.15s ease',
    normal: '0.2s ease',
    slow: '0.3s ease',
  },

  sidebar: {
    width: '260px',
    collapsedWidth: '60px',
  },

  breakpoints: {
    sm: '640px',
    md: '768px',
    lg: '1024px',
    xl: '1280px',
    '2xl': '1536px',
  },
};

export type Theme = typeof theme;

// Ant Design 主题配置 — Linear 化:小圆角、无投影、紧凑密度
export const antdTheme = {
  token: {
    colorPrimary: theme.colors.primary,
    colorBgLayout: theme.colors.bgBody,
    colorBgContainer: theme.colors.bgPanel,
    colorBorder: theme.colors.border,
    colorBorderSecondary: '#EFEAE0',
    colorText: theme.colors.textPrimary,
    colorTextSecondary: theme.colors.textSecondary,
    fontFamily: theme.fonts.sans,
    fontSize: 13,
    borderRadius: 6,
    controlHeight: 30,
    colorLink: theme.colors.primary,
    colorLinkHover: theme.colors.primaryHover,
  },
  components: {
    Button: {
      borderRadius: 6,
      fontFamily: theme.fonts.sans,
      primaryShadow: 'none',
      defaultShadow: 'none',
      fontWeight: 500,
    },
    Input: {
      borderRadius: 6,
      fontFamily: theme.fonts.sans,
      activeBorderColor: '#002FA7',
      hoverBorderColor: '#4A7FA5',
      activeShadow: '0 0 0 3px rgba(0, 47, 167, 0.12)',
    },
    Select: {
      borderRadius: 6,
      fontFamily: theme.fonts.sans,
    },
    Modal: {
      borderRadiusLG: 10,
    },
    Card: {
      borderRadiusLG: 8,
    },
    Table: {
      headerBg: 'transparent',
      cellPaddingBlock: 11,
    },
  },
};
