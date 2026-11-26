# Admin 端重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 codesphere-admin-saas/apps/admin 从视觉/IA/操作流混乱重构为基于 Raytone V1 设计规范的清晰运营后台,5 个样板页面落地后其余页面套样板继续迁移。

**Architecture:**
- 设计 token 接入 codesphere-frontend-saas/src/styles/theme.ts (Raytone V1)
- 抽 5 个共用组件 (PageHeader / StatCard / FilterBar / DataTable / DetailDrawer) 统一所有页面
- 顶部产品筛选器 + ProductContext 全局上下文,localStorage 持久化
- 路由表重排 + 权限点前端映射 (后端 0 改动)
- 5 样板页:Dashboard / Users / UserDetail (动态产品卡) / Channels / Orders (Drawer 时间线)

**Tech Stack:** Vite 6 + React 19 + AntD 5 + Pro Components + TypeScript + vitest + RTL + Playwright

**Spec:** `docs/superpowers/specs/2026-04-27-admin-redesign-design.md`

**Constraints (红线):**
- ❌ 不改后端 API、Schema、Stripe、Webhook、计费逻辑
- ❌ 不修改 Order/Subscription 等业务枚举
- ✅ 仅 admin 前端 (apps/admin) 路由 / 组件 / 样式 / IA
- ✅ 权限点改动通过前端映射表 LEGACY_PERMISSION_MAP,后端 key 不动

**File Structure (将创建/修改):**

新建:
- `apps/admin/src/styles/theme.ts` — Raytone V1 token (复用 saas 前端)
- `apps/admin/src/styles/tokens.css` — CSS 变量
- `apps/admin/src/test/setup.ts` — vitest setup
- `apps/admin/src/components/common/PageHeader.tsx`
- `apps/admin/src/components/common/StatCard.tsx`
- `apps/admin/src/components/common/FilterBar.tsx`
- `apps/admin/src/components/common/DataTable.tsx`
- `apps/admin/src/components/common/DetailDrawer.tsx`
- `apps/admin/src/components/common/Tag.tsx` (受控 variant)
- `apps/admin/src/components/common/__tests__/*.test.tsx`
- `apps/admin/src/contexts/ProductContext.tsx`
- `apps/admin/src/hooks/useCurrentProduct.ts`
- `apps/admin/src/hooks/useLegacyPermission.ts`
- `apps/admin/src/components/Layout/ProductSwitcher.tsx`
- `apps/admin/src/pages/ApiKeys/index.tsx` (新增页面)
- `apps/admin/src/pages/UserDetail/ProductAccountCard.tsx` (拆分子组件)
- `apps/admin/src/pages/UserDetail/CodingPlanCard.tsx`
- `apps/admin/src/pages/UserDetail/SubscriptionCard.tsx`
- `apps/admin/src/pages/UserDetail/PayAsYouGoCard.tsx`
- `apps/admin/vitest.config.ts`

修改:
- `apps/admin/src/main.tsx` — import tokens.css
- `apps/admin/src/app.tsx` — ConfigProvider 接 antdTheme,路由表重排
- `apps/admin/src/admin-shell.css` — 改用 token
- `apps/admin/src/layouts/AdminLayout.tsx` — Sider 240 / 分组样式 / 激活态 / 顶部产品筛选器
- `apps/admin/src/config/permissions.ts` — 加 LEGACY_PERMISSION_MAP + 新 key
- `apps/admin/src/hooks/usePermission.ts` — 走映射表
- `apps/admin/src/pages/Dashboard/index.tsx` — 重做
- `apps/admin/src/pages/Users/index.tsx` — 重做
- `apps/admin/src/pages/UserDetail/index.tsx` — 重做(主壳 + Tabs)
- `apps/admin/src/pages/Channels/index.tsx` — 重做
- `apps/admin/src/pages/Orders/index.tsx` — 重做(Drawer 时间线)
- `apps/admin/package.json` — 加 vitest / @testing-library / jsdom 依赖

删除/废弃 (route 移除,文件保留作为参考):
- `apps/admin/src/pages/ModelAccess/` (功能合并到 PlanDetail / ApiKeys)

**Phase 划分:**
- Phase 0: 基础设施 (Task 1-7)
- Phase 1: 壳与导航 (Task 8-13)
- Phase 2: 5 样板页面 (Task 14-22)
- Phase 3: 财务数据补齐 (Task 23-25)
- Phase 4: 全量回归 + 文档 (Task 26-27)

---

## Phase 0: 基础设施

### Task 1: Bootstrap vitest + React Testing Library

**Files:**
- Modify: `apps/admin/package.json`
- Create: `apps/admin/vitest.config.ts`
- Create: `apps/admin/src/test/setup.ts`

- [ ] **Step 1: 安装依赖**

```bash
cd /Users/shineli/ruidong/codesphere-admin-saas/apps/admin
pnpm add -D vitest @vitest/ui @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

- [ ] **Step 2: 创建 vitest 配置**

写到 `apps/admin/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    css: false,
    coverage: {
      reporter: ['text', 'html'],
      thresholds: { lines: 85, functions: 85, branches: 80, statements: 85 },
      include: ['src/components/common/**', 'src/contexts/**', 'src/hooks/**'],
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
```

- [ ] **Step 3: 创建 test setup**

写到 `apps/admin/src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
```

- [ ] **Step 4: 加 npm scripts**

修改 `apps/admin/package.json` 的 scripts 段:
```json
"test": "vitest run",
"test:watch": "vitest",
"test:ui": "vitest --ui",
"test:coverage": "vitest run --coverage"
```

- [ ] **Step 5: 写一个 smoke test**

写到 `apps/admin/src/test/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('test framework works', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: 跑测试验证**

Run: `cd apps/admin && pnpm test`
Expected: PASS, 1 test

- [ ] **Step 7: Commit**

```bash
cd /Users/shineli/ruidong/codesphere-admin-saas
git add apps/admin/package.json apps/admin/vitest.config.ts apps/admin/src/test/ pnpm-lock.yaml
git commit -m "chore(admin): bootstrap vitest + React Testing Library"
```

---

### Task 2: 接入 Raytone V1 设计 token

**Files:**
- Create: `apps/admin/src/styles/theme.ts`
- Create: `apps/admin/src/styles/tokens.css`

- [ ] **Step 1: 拷贝 Raytone theme**

从 `codesphere-frontend-saas/src/styles/theme.ts` 完整拷贝内容到 `apps/admin/src/styles/theme.ts`,保持 named export `theme` 和 `antdTheme`。

- [ ] **Step 2: 创建 CSS 变量**

写到 `apps/admin/src/styles/tokens.css`:
```css
:root {
  --bg-body: #F5F2EC;
  --bg-panel: #FAFAF7;
  --bg-hover: rgba(14, 42, 71, 0.04);
  --bg-active: rgba(14, 42, 71, 0.08);

  --primary: #0E2A47;
  --primary-dark: #0A0F1A;
  --accent: #E8B464;

  --text: #2A2F3A;
  --text-secondary: #6B7280;
  --text-muted: #8B94A3;

  --border: #C9CDD3;
  --border-soft: #E7E1D7;
  --border-divider: #F1ECE2;

  --success: #4A9B7F;
  --success-bg: rgba(74, 155, 127, 0.14);
  --success-text: #2F6B53;

  --warning: #D98A3D;
  --warning-bg: rgba(217, 138, 61, 0.14);
  --warning-text: #8A5726;

  --error: #C85A54;
  --error-bg: rgba(200, 90, 84, 0.14);
  --error-text: #8C3F3A;

  --info: #4A7FA5;
  --info-bg: rgba(74, 127, 165, 0.16);
  --info-text: #2D5C7E;

  --muted-bg: rgba(107, 114, 128, 0.12);
  --muted-text: #4F5867;

  --gold-bg: rgba(232, 180, 100, 0.18);
  --gold-text: #8A5726;

  --radius-card: 8px;
  --radius-modal: 16px;
  --radius-pill: 999px;

  --shadow-sm: 0 1px 2px rgba(14, 42, 71, 0.04);
  --shadow-md: 0 1px 2px rgba(14, 42, 71, 0.04), 0 4px 12px rgba(14, 42, 71, 0.06);

  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Source Han Sans SC', 'PingFang SC', sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;

  --fs-xs: 11px;
  --fs-sm: 12px;
  --fs-base: 13px;
  --fs-md: 14px;
  --fs-lg: 16px;
  --fs-xl: 18px;
  --fs-2xl: 22px;

  font-family: var(--font-sans);
  font-size: var(--fs-base);
  color: var(--text);
  background: var(--bg-body);
}

body { margin: 0; }
```

- [ ] **Step 3: 重写 admin-shell.css**

替换 `apps/admin/src/admin-shell.css` 全部内容为:
```css
@import './styles/tokens.css';

#root {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

h1, h2, h3, h4 {
  font-family: var(--font-sans);
  font-weight: 500;
  color: var(--primary-dark);
  margin: 0;
}
```

- [ ] **Step 4: 在 main.tsx 确认 import**

确认 `apps/admin/src/main.tsx` 已 `import './admin-shell.css';` (现有就有)。

- [ ] **Step 5: 在 app.tsx 接入 antdTheme**

修改 `apps/admin/src/app.tsx` 顶部 import:
```ts
import { antdTheme } from './styles/theme';
```

替换 `<ConfigProvider locale={zhCN} theme={{...}}>` 整段为:
```tsx
<ConfigProvider locale={zhCN} theme={antdTheme}>
```

- [ ] **Step 6: 跑 dev 验证视觉**

```bash
cd apps/admin && pnpm dev
```

打开 http://localhost:5174,确认:
- 页面背景米白 (#F5F2EC)
- Sider/Card 纸白 (#FAFAF7)
- 主操作按钮深海蓝
- 字体 Inter

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/styles/ apps/admin/src/admin-shell.css apps/admin/src/app.tsx
git commit -m "feat(admin): integrate Raytone V1 design tokens"
```

---

### Task 3: 共用组件 — Tag (受控 variant)

**Files:**
- Create: `apps/admin/src/components/common/Tag.tsx`
- Create: `apps/admin/src/components/common/__tests__/Tag.test.tsx`

- [ ] **Step 1: 写 failing test**

写到 `apps/admin/src/components/common/__tests__/Tag.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Tag } from '../Tag';

describe('Tag', () => {
  it('renders text content', () => {
    render(<Tag variant="success">启用</Tag>);
    expect(screen.getByText('启用')).toBeInTheDocument();
  });

  it('applies variant class', () => {
    const { container } = render(<Tag variant="error">异常</Tag>);
    expect(container.firstChild).toHaveClass('rt-tag', 'rt-tag-error');
  });

  it('defaults to muted variant', () => {
    const { container } = render(<Tag>类型</Tag>);
    expect(container.firstChild).toHaveClass('rt-tag-muted');
  });

  it('rejects unknown variants at compile time (smoke)', () => {
    render(<Tag variant="muted">中性</Tag>);
    expect(screen.getByText('中性')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑测试验证 fail**

Run: `cd apps/admin && pnpm test src/components/common/__tests__/Tag.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 Tag 组件**

写到 `apps/admin/src/components/common/Tag.tsx`:
```tsx
import { ReactNode } from 'react';
import './Tag.css';

export type TagVariant = 'success' | 'warn' | 'error' | 'proc' | 'muted';

interface TagProps {
  variant?: TagVariant;
  children: ReactNode;
}

export function Tag({ variant = 'muted', children }: TagProps) {
  return <span className={`rt-tag rt-tag-${variant}`}>{children}</span>;
}
```

写到 `apps/admin/src/components/common/Tag.css`:
```css
.rt-tag {
  display: inline-block;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
  line-height: 18px;
  white-space: nowrap;
}
.rt-tag-success { background: var(--success-bg); color: var(--success-text); }
.rt-tag-warn    { background: var(--warning-bg); color: var(--warning-text); }
.rt-tag-error   { background: var(--error-bg); color: var(--error-text); }
.rt-tag-proc    { background: var(--info-bg); color: var(--info-text); }
.rt-tag-muted   { background: var(--muted-bg); color: var(--muted-text); }
```

- [ ] **Step 4: 跑测试**

Run: `cd apps/admin && pnpm test src/components/common/__tests__/Tag.test.tsx`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/components/common/Tag.tsx apps/admin/src/components/common/Tag.css apps/admin/src/components/common/__tests__/Tag.test.tsx
git commit -m "feat(admin): add Tag common component with controlled variants"
```

---

### Task 4: 共用组件 — PageHeader

**Files:**
- Create: `apps/admin/src/components/common/PageHeader.tsx`
- Create: `apps/admin/src/components/common/PageHeader.css`
- Create: `apps/admin/src/components/common/__tests__/PageHeader.test.tsx`

- [ ] **Step 1: 写 failing test**

写到 `apps/admin/src/components/common/__tests__/PageHeader.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { PageHeader } from '../PageHeader';

const wrap = (ui: React.ReactNode) => <MemoryRouter>{ui}</MemoryRouter>;

describe('PageHeader', () => {
  it('renders title and subtitle', () => {
    render(wrap(<PageHeader title="用户管理" subtitle="副标题" />));
    expect(screen.getByText('用户管理')).toBeInTheDocument();
    expect(screen.getByText('副标题')).toBeInTheDocument();
  });

  it('renders breadcrumb items as links and current page', () => {
    render(wrap(
      <PageHeader
        title="详情"
        breadcrumb={[{ label: '用户列表', to: '/users' }, '详情']}
      />,
    ));
    const link = screen.getByText('用户列表');
    expect(link.closest('a')).toHaveAttribute('href', '/users');
    expect(screen.getByText('详情', { selector: '.rt-ph-crumb-current' })).toBeInTheDocument();
  });

  it('renders action nodes', () => {
    render(wrap(
      <PageHeader
        title="x"
        actions={[<button key="a">导出</button>, <button key="b">新建</button>]}
      />,
    ));
    expect(screen.getByText('导出')).toBeInTheDocument();
    expect(screen.getByText('新建')).toBeInTheDocument();
  });

  it('omits subtitle when not provided', () => {
    const { container } = render(wrap(<PageHeader title="x" />));
    expect(container.querySelector('.rt-ph-sub')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试验证 fail**

Run: `cd apps/admin && pnpm test src/components/common/__tests__/PageHeader.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 PageHeader**

写到 `apps/admin/src/components/common/PageHeader.tsx`:
```tsx
import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import './PageHeader.css';

export type BreadcrumbItem = string | { label: string; to: string };

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  breadcrumb?: BreadcrumbItem[];
  actions?: ReactNode[];
}

export function PageHeader({ title, subtitle, breadcrumb, actions }: PageHeaderProps) {
  return (
    <div className="rt-ph">
      <div className="rt-ph-l">
        {breadcrumb && breadcrumb.length > 0 && (
          <div className="rt-ph-crumb">
            {breadcrumb.map((item, i) => {
              const isLast = i === breadcrumb.length - 1;
              if (typeof item === 'string') {
                return (
                  <span key={i} className={isLast ? 'rt-ph-crumb-current' : ''}>
                    {item}
                    {!isLast && <span className="rt-ph-crumb-sep"> / </span>}
                  </span>
                );
              }
              return (
                <span key={i}>
                  <Link to={item.to}>{item.label}</Link>
                  {!isLast && <span className="rt-ph-crumb-sep"> / </span>}
                </span>
              );
            })}
          </div>
        )}
        <div className="rt-ph-title">{title}</div>
        {subtitle && <div className="rt-ph-sub">{subtitle}</div>}
      </div>
      {actions && actions.length > 0 && (
        <div className="rt-ph-r">{actions}</div>
      )}
    </div>
  );
}
```

写到 `apps/admin/src/components/common/PageHeader.css`:
```css
.rt-ph {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
  gap: 12px;
}
.rt-ph-l { flex: 1; min-width: 0; }
.rt-ph-crumb {
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  margin-bottom: 4px;
}
.rt-ph-crumb a { color: var(--primary); text-decoration: none; }
.rt-ph-crumb a:hover { text-decoration: underline; }
.rt-ph-crumb-sep { color: var(--text-muted); margin: 0 4px; }
.rt-ph-crumb-current { color: var(--text); }
.rt-ph-title {
  font-size: var(--fs-xl);
  font-weight: 500;
  color: var(--primary-dark);
  line-height: 1.3;
}
.rt-ph-sub {
  font-size: var(--fs-sm);
  color: var(--text-secondary);
  margin-top: 4px;
}
.rt-ph-r {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
```

- [ ] **Step 4: 跑测试**

Run: `cd apps/admin && pnpm test src/components/common/__tests__/PageHeader.test.tsx`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/components/common/PageHeader.* apps/admin/src/components/common/__tests__/PageHeader.test.tsx
git commit -m "feat(admin): add PageHeader common component"
```

---

### Task 5: 共用组件 — StatCard / StatCardGroup

**Files:**
- Create: `apps/admin/src/components/common/StatCard.tsx`
- Create: `apps/admin/src/components/common/StatCard.css`
- Create: `apps/admin/src/components/common/__tests__/StatCard.test.tsx`

- [ ] **Step 1: 写 failing test**

写到 `apps/admin/src/components/common/__tests__/StatCard.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatCard, StatCardGroup } from '../StatCard';

describe('StatCard', () => {
  it('renders label and value', () => {
    render(<StatCard label="总用户" value={12486} />);
    expect(screen.getByText('总用户')).toBeInTheDocument();
    expect(screen.getByText('12,486')).toBeInTheDocument();
  });

  it('renders string value as-is', () => {
    render(<StatCard label="GMV" value="¥328,450" />);
    expect(screen.getByText('¥328,450')).toBeInTheDocument();
  });

  it('renders delta with up trend', () => {
    render(<StatCard label="x" value={1} delta={{ value: 124, period: '本周', trend: 'up' }} />);
    expect(screen.getByText(/124/)).toBeInTheDocument();
    expect(screen.getByText(/本周/)).toBeInTheDocument();
  });

  it('applies error variant class', () => {
    const { container } = render(<StatCard label="异常" value={17} variant="error" />);
    expect(container.querySelector('.rt-stat-value')).toHaveClass('rt-stat-value-error');
  });
});

describe('StatCardGroup', () => {
  it('renders children in grid', () => {
    const { container } = render(
      <StatCardGroup>
        <StatCard label="a" value={1} />
        <StatCard label="b" value={2} />
      </StatCardGroup>,
    );
    expect(container.querySelectorAll('.rt-stat')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 跑测试验证 fail**

Run: `cd apps/admin && pnpm test src/components/common/__tests__/StatCard.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: 实现**

写到 `apps/admin/src/components/common/StatCard.tsx`:
```tsx
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

export function StatCard({ label, value, delta, variant = 'default' }: StatCardProps) {
  const valueClass = `rt-stat-value rt-stat-value-${variant}`;
  return (
    <div className="rt-stat">
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
```

写到 `apps/admin/src/components/common/StatCard.css`:
```css
.rt-stat-group {
  display: grid;
  gap: 12px;
  margin-bottom: 16px;
}
@media (max-width: 1024px) {
  .rt-stat-group { grid-template-columns: repeat(2, 1fr) !important; }
}
.rt-stat {
  background: var(--bg-panel);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-card);
  padding: 12px 14px;
}
.rt-stat-label {
  color: var(--text-muted);
  font-size: var(--fs-xs);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.rt-stat-value {
  color: var(--primary-dark);
  font-size: var(--fs-2xl);
  font-weight: 500;
  margin-top: 6px;
  font-variant-numeric: tabular-nums;
}
.rt-stat-value-success { color: var(--success); }
.rt-stat-value-warning { color: var(--warning); }
.rt-stat-value-error   { color: var(--error); }
.rt-stat-delta {
  font-size: var(--fs-xs);
  margin-top: 4px;
  color: var(--text-secondary);
}
.rt-stat-delta-up   { color: var(--success); }
.rt-stat-delta-down { color: var(--error); }
```

- [ ] **Step 4: 跑测试**

Run: `cd apps/admin && pnpm test src/components/common/__tests__/StatCard.test.tsx`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/components/common/StatCard.* apps/admin/src/components/common/__tests__/StatCard.test.tsx
git commit -m "feat(admin): add StatCard / StatCardGroup common components"
```

---

### Task 6: 共用组件 — FilterBar

**Files:**
- Create: `apps/admin/src/components/common/FilterBar.tsx`
- Create: `apps/admin/src/components/common/FilterBar.css`
- Create: `apps/admin/src/components/common/__tests__/FilterBar.test.tsx`

- [ ] **Step 1: 写 failing test**

写到 `apps/admin/src/components/common/__tests__/FilterBar.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FilterBar } from '../FilterBar';

describe('FilterBar', () => {
  it('renders search input', () => {
    render(<FilterBar search={{ placeholder: '搜索...', onSearch: () => {} }} />);
    expect(screen.getByPlaceholderText('搜索...')).toBeInTheDocument();
  });

  it('calls onSearch when input changes (debounced)', async () => {
    const onSearch = vi.fn();
    render(<FilterBar search={{ placeholder: '搜索', onSearch, debounceMs: 0 }} />);
    fireEvent.change(screen.getByPlaceholderText('搜索'), { target: { value: 'abc' } });
    await new Promise((r) => setTimeout(r, 5));
    expect(onSearch).toHaveBeenCalledWith('abc');
  });

  it('renders filter children', () => {
    render(
      <FilterBar filters={[<div key="x">F1</div>, <div key="y">F2</div>]} />,
    );
    expect(screen.getByText('F1')).toBeInTheDocument();
    expect(screen.getByText('F2')).toBeInTheDocument();
  });

  it('renders chips and triggers onRemove', () => {
    const onRemove = vi.fn();
    render(
      <FilterBar
        activeChips={[{ key: 'k', label: '异常账号', onRemove }]}
      />,
    );
    fireEvent.click(screen.getByLabelText('移除筛选: 异常账号'));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('renders right actions', () => {
    render(<FilterBar rightActions={<a>导出</a>} />);
    expect(screen.getByText('导出')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑测试验证 fail**

Run: `cd apps/admin && pnpm test src/components/common/__tests__/FilterBar.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现**

写到 `apps/admin/src/components/common/FilterBar.tsx`:
```tsx
import { ReactNode, useEffect, useRef, useState } from 'react';
import './FilterBar.css';

interface SearchProp {
  placeholder?: string;
  value?: string;
  onSearch: (value: string) => void;
  debounceMs?: number;
}

interface ChipProp {
  key: string;
  label: string;
  onRemove: () => void;
}

interface FilterBarProps {
  search?: SearchProp;
  filters?: ReactNode[];
  activeChips?: ChipProp[];
  rightActions?: ReactNode;
}

export function FilterBar({ search, filters, activeChips, rightActions }: FilterBarProps) {
  const [val, setVal] = useState(search?.value ?? '');
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!search) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => search.onSearch(val), search.debounceMs ?? 300);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [val]);

  return (
    <div className="rt-fb">
      {search && (
        <input
          className="rt-fb-input"
          placeholder={search.placeholder ?? '搜索...'}
          value={val}
          onChange={(e) => setVal(e.target.value)}
        />
      )}
      {filters?.map((f, i) => (
        <div key={i} className="rt-fb-filter">{f}</div>
      ))}
      {activeChips?.map((c) => (
        <span key={c.key} className="rt-fb-chip">
          {c.label}
          <button
            type="button"
            className="rt-fb-chip-x"
            aria-label={`移除筛选: ${c.label}`}
            onClick={c.onRemove}
          >
            ✕
          </button>
        </span>
      ))}
      <div className="rt-fb-spacer" />
      {rightActions && <div className="rt-fb-right">{rightActions}</div>}
    </div>
  );
}
```

写到 `apps/admin/src/components/common/FilterBar.css`:
```css
.rt-fb {
  background: var(--bg-panel);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-card);
  padding: 10px 12px;
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.rt-fb-input {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: 6px 10px;
  font-size: var(--fs-sm);
  width: 220px;
  font-family: inherit;
  color: var(--text);
}
.rt-fb-input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(14, 42, 71, 0.10);
}
.rt-fb-filter { display: inline-flex; }
.rt-fb-chip {
  background: var(--bg-active);
  border: 1px solid rgba(14, 42, 71, 0.15);
  border-radius: var(--radius-pill);
  padding: 3px 6px 3px 10px;
  font-size: var(--fs-xs);
  color: var(--primary);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.rt-fb-chip-x {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--primary);
  padding: 0 4px;
  font-size: var(--fs-xs);
}
.rt-fb-spacer { flex: 1; }
.rt-fb-right { display: flex; gap: 8px; align-items: center; }
```

- [ ] **Step 4: 跑测试**

Run: `cd apps/admin && pnpm test src/components/common/__tests__/FilterBar.test.tsx`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/components/common/FilterBar.* apps/admin/src/components/common/__tests__/FilterBar.test.tsx
git commit -m "feat(admin): add FilterBar common component"
```

---

### Task 7: 共用组件 — DataTable + DetailDrawer

**Files:**
- Create: `apps/admin/src/components/common/DataTable.tsx`
- Create: `apps/admin/src/components/common/DataTable.css`
- Create: `apps/admin/src/components/common/DetailDrawer.tsx`
- Create: `apps/admin/src/components/common/DetailDrawer.css`
- Create: `apps/admin/src/components/common/__tests__/DataTable.test.tsx`
- Create: `apps/admin/src/components/common/__tests__/DetailDrawer.test.tsx`

- [ ] **Step 1: 写 DataTable failing test**

写到 `apps/admin/src/components/common/__tests__/DataTable.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DataTable } from '../DataTable';

interface Row { id: string; name: string }
const rows: Row[] = [{ id: '1', name: 'Alice' }, { id: '2', name: 'Bob' }];

describe('DataTable', () => {
  it('renders rows', () => {
    render(
      <DataTable<Row>
        columns={[{ title: '姓名', dataIndex: 'name', key: 'name' }]}
        dataSource={rows}
        rowKey="id"
      />,
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('triggers onRowClick', () => {
    const onRowClick = vi.fn();
    render(
      <DataTable<Row>
        columns={[{ title: '姓名', dataIndex: 'name', key: 'name' }]}
        dataSource={rows}
        rowKey="id"
        onRowClick={onRowClick}
      />,
    );
    fireEvent.click(screen.getByText('Alice'));
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it('marks selected row', () => {
    const { container } = render(
      <DataTable<Row>
        columns={[{ title: '姓名', dataIndex: 'name', key: 'name' }]}
        dataSource={rows}
        rowKey="id"
        selectedRowKey="1"
      />,
    );
    const selected = container.querySelector('.ant-table-row.rt-row-selected');
    expect(selected).not.toBeNull();
  });
});
```

- [ ] **Step 2: 跑 fail**

Run: `cd apps/admin && pnpm test src/components/common/__tests__/DataTable.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现 DataTable**

写到 `apps/admin/src/components/common/DataTable.tsx`:
```tsx
import { Table, TableProps } from 'antd';
import './DataTable.css';

interface DataTableProps<T> extends Omit<TableProps<T>, 'rowClassName' | 'onRow'> {
  selectedRowKey?: string | number;
  onRowClick?: (record: T) => void;
}

export function DataTable<T extends object>(props: DataTableProps<T>) {
  const { selectedRowKey, onRowClick, ...rest } = props;
  return (
    <div className="rt-table">
      <Table<T>
        {...rest}
        rowClassName={(record) => {
          const key = (record as Record<string, unknown>)[props.rowKey as string];
          return selectedRowKey != null && String(key) === String(selectedRowKey)
            ? 'rt-row-selected'
            : '';
        }}
        onRow={(record) => ({
          onClick: () => onRowClick?.(record),
          style: onRowClick ? { cursor: 'pointer' } : undefined,
        })}
      />
    </div>
  );
}
```

写到 `apps/admin/src/components/common/DataTable.css`:
```css
.rt-table {
  background: var(--bg-panel);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-card);
  overflow: hidden;
}
.rt-table .ant-table-thead > tr > th {
  background: rgba(14, 42, 71, 0.02);
  color: var(--text-muted);
  font-size: var(--fs-xs);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  border-bottom: 1px solid var(--border-soft);
}
.rt-table .ant-table-tbody > tr > td {
  font-size: var(--fs-sm);
  color: var(--text);
  border-bottom: 1px solid var(--border-divider);
  padding: 10px 12px;
}
.rt-table .ant-table-tbody > tr:hover > td {
  background: rgba(14, 42, 71, 0.025) !important;
}
.rt-table .ant-table-tbody > tr.rt-row-selected > td {
  background: rgba(14, 42, 71, 0.06) !important;
}
.rt-table .ant-table-tbody > tr:last-child > td {
  border-bottom: none;
}
.rt-table .ant-pagination {
  padding: 10px 12px;
  margin: 0;
}
```

- [ ] **Step 4: 跑 DataTable 测试**

Run: `cd apps/admin && pnpm test src/components/common/__tests__/DataTable.test.tsx`
Expected: PASS, 3 tests

- [ ] **Step 5: 写 DetailDrawer failing test**

写到 `apps/admin/src/components/common/__tests__/DetailDrawer.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DetailDrawer } from '../DetailDrawer';

describe('DetailDrawer', () => {
  it('does not render when open=false', () => {
    render(
      <DetailDrawer open={false} onClose={() => {}} title="x" tabs={[]} />,
    );
    expect(screen.queryByText('x')).toBeNull();
  });

  it('renders title and subtitle when open', () => {
    render(
      <DetailDrawer
        open
        onClose={() => {}}
        title="ORD-1"
        subtitle="alice@example.com"
        tabs={[{ key: 'a', label: 'Tab', content: <div>contentA</div> }]}
      />,
    );
    expect(screen.getByText('ORD-1')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('contentA')).toBeInTheDocument();
  });

  it('switches tabs', () => {
    render(
      <DetailDrawer
        open
        onClose={() => {}}
        title="t"
        tabs={[
          { key: 'a', label: 'A', content: <div>contentA</div> },
          { key: 'b', label: 'B', content: <div>contentB</div> },
        ]}
      />,
    );
    fireEvent.click(screen.getByText('B'));
    expect(screen.getByText('contentB')).toBeInTheDocument();
  });

  it('calls onClose', () => {
    const onClose = vi.fn();
    render(
      <DetailDrawer open onClose={onClose} title="t" tabs={[]} />,
    );
    fireEvent.click(screen.getByLabelText('关闭'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 6: 跑 fail**

Run: `cd apps/admin && pnpm test src/components/common/__tests__/DetailDrawer.test.tsx`
Expected: FAIL

- [ ] **Step 7: 实现 DetailDrawer**

写到 `apps/admin/src/components/common/DetailDrawer.tsx`:
```tsx
import { ReactNode, useState } from 'react';
import { Drawer } from 'antd';
import './DetailDrawer.css';

interface DrawerTab {
  key: string;
  label: string;
  content: ReactNode;
}

interface DetailDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  status?: ReactNode;
  tabs: DrawerTab[];
  actions?: ReactNode;
  width?: number | string;
}

export function DetailDrawer({
  open, onClose, title, subtitle, status, tabs, actions, width = '40%',
}: DetailDrawerProps) {
  const [active, setActive] = useState(tabs[0]?.key);
  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={width}
      closable={false}
      maskClosable
      className="rt-drawer"
      title={
        <div className="rt-drawer-head">
          <div>
            <div className="rt-drawer-title">{title}</div>
            {subtitle && <div className="rt-drawer-sub">{subtitle}</div>}
          </div>
          <div className="rt-drawer-status">
            {status}
            <button
              type="button"
              className="rt-drawer-x"
              aria-label="关闭"
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </div>
      }
      footer={actions ? <div className="rt-drawer-actions">{actions}</div> : null}
    >
      {tabs.length > 0 && (
        <div className="rt-drawer-tabs">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`rt-drawer-tab ${t.key === active ? 'rt-drawer-tab-active' : ''}`}
              onClick={() => setActive(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div className="rt-drawer-body">{current?.content}</div>
    </Drawer>
  );
}
```

写到 `apps/admin/src/components/common/DetailDrawer.css`:
```css
.rt-drawer .ant-drawer-header { border-bottom: 1px solid var(--border-soft); padding: 14px 18px; }
.rt-drawer .ant-drawer-body { padding: 14px 18px; }
.rt-drawer-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.rt-drawer-title { font-size: var(--fs-md); font-weight: 500; color: var(--primary-dark); }
.rt-drawer-sub { font-size: var(--fs-xs); color: var(--text-muted); margin-top: 3px; }
.rt-drawer-status { display: flex; align-items: center; gap: 8px; }
.rt-drawer-x { background: transparent; border: none; cursor: pointer; color: var(--text-muted); font-size: var(--fs-md); }
.rt-drawer-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--border-soft); margin-bottom: 12px; }
.rt-drawer-tab { padding: 6px 12px; font-size: var(--fs-sm); color: var(--text-secondary); border: none; background: transparent; border-bottom: 2px solid transparent; cursor: pointer; }
.rt-drawer-tab-active { color: var(--primary); border-bottom-color: var(--primary); font-weight: 500; }
.rt-drawer-actions { display: flex; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--border-soft); }
```

- [ ] **Step 8: 跑测试**

Run: `cd apps/admin && pnpm test src/components/common/__tests__/`
Expected: 所有共用组件测试 PASS

- [ ] **Step 9: 创建 index.ts barrel**

写到 `apps/admin/src/components/common/index.ts`:
```ts
export { Tag } from './Tag';
export type { TagVariant } from './Tag';
export { PageHeader } from './PageHeader';
export type { BreadcrumbItem } from './PageHeader';
export { StatCard, StatCardGroup } from './StatCard';
export type { StatVariant } from './StatCard';
export { FilterBar } from './FilterBar';
export { DataTable } from './DataTable';
export { DetailDrawer } from './DetailDrawer';
```

- [ ] **Step 10: Commit**

```bash
git add apps/admin/src/components/common/
git commit -m "feat(admin): add DataTable + DetailDrawer + index barrel"
```

---

## Phase 1: 壳与导航

### Task 8: 权限映射表 + useLegacyPermission Hook

**Files:**
- Modify: `apps/admin/src/config/permissions.ts`
- Create: `apps/admin/src/hooks/useLegacyPermission.ts`
- Modify: `apps/admin/src/hooks/usePermission.ts`
- Create: `apps/admin/src/hooks/__tests__/useLegacyPermission.test.tsx`

- [ ] **Step 1: 写 failing test**

写到 `apps/admin/src/hooks/__tests__/useLegacyPermission.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { mapPermission, expandPermissions, hasNewPermission } from '../useLegacyPermission';

describe('mapPermission', () => {
  it('maps old to new key', () => {
    expect(mapPermission('admin.users.manage')).toBe('users.manage');
    expect(mapPermission('admin.orders.manage')).toBe('finance.orders.manage');
    expect(mapPermission('admin.booster_packs.manage')).toBe('products.plans.manage');
  });

  it('returns input if no mapping', () => {
    expect(mapPermission('unknown.key')).toBe('unknown.key');
  });
});

describe('expandPermissions', () => {
  it('returns both old and new keys for owned old keys', () => {
    const result = expandPermissions(['admin.users.manage']);
    expect(result).toContain('admin.users.manage');
    expect(result).toContain('users.manage');
  });

  it('handles multiple', () => {
    const result = expandPermissions(['admin.roles.manage', 'admin.members.manage']);
    expect(result).toContain('system.team.manage');
  });
});

describe('hasNewPermission', () => {
  it('checks against expanded set', () => {
    expect(hasNewPermission(['admin.users.manage'], 'users.manage')).toBe(true);
    expect(hasNewPermission(['admin.users.manage'], 'finance.orders.manage')).toBe(false);
  });
});
```

- [ ] **Step 2: 跑 fail**

Run: `cd apps/admin && pnpm test src/hooks/__tests__/useLegacyPermission.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 mapping**

写到 `apps/admin/src/hooks/useLegacyPermission.ts`:
```ts
export const LEGACY_PERMISSION_MAP: Record<string, string> = {
  'admin.dashboard': 'dashboard.view',
  'admin.users.view': 'users.view',
  'admin.users.manage': 'users.manage',
  'admin.products.manage': 'products.manage',
  'admin.plans.view': 'products.plans.view',
  'admin.plans.manage': 'products.plans.manage',
  'admin.booster_packs.manage': 'products.plans.manage',
  'admin.campaigns.manage': 'products.plans.manage',
  'admin.discount_codes.manage': 'products.plans.manage',
  'admin.orders.view': 'finance.orders.view',
  'admin.orders.manage': 'finance.orders.manage',
  'admin.transactions.view': 'finance.usage.read',
  'admin.revenue.view': 'finance.revenue.read',
  'admin.payment_config.manage': 'finance.payment.manage',
  'admin.system.manage': 'system.config.manage',
  'admin.channels.view': 'ops.channels.view',
  'admin.channels.manage': 'ops.channels.manage',
  'admin.model_pricing.manage': 'ops.pricing.manage',
  'admin.sessions.read': 'audit.monitoring.read',
  'admin.monitoring.view': 'audit.monitoring.read',
  'admin.audit.view': 'audit.logs.read',
  'admin.announcements.manage': 'audit.announcements.manage',
  'admin.roles.manage': 'system.team.manage',
  'admin.members.manage': 'system.team.manage',
};

export function mapPermission(legacyKey: string): string {
  return LEGACY_PERMISSION_MAP[legacyKey] ?? legacyKey;
}

export function expandPermissions(owned: string[]): string[] {
  const set = new Set<string>(owned);
  for (const key of owned) {
    const mapped = LEGACY_PERMISSION_MAP[key];
    if (mapped) set.add(mapped);
  }
  return [...set];
}

export function hasNewPermission(owned: string[], newKey: string): boolean {
  return expandPermissions(owned).includes(newKey);
}
```

- [ ] **Step 4: 跑测试**

Run: `cd apps/admin && pnpm test src/hooks/__tests__/useLegacyPermission.test.tsx`
Expected: PASS

- [ ] **Step 5: 修改 usePermission Hook**

读 `apps/admin/src/hooks/usePermission.ts` 现状,在内部调用 `expandPermissions` 后再 includes:

```ts
import { useAuth } from '../store/AuthContext';
import { expandPermissions } from './useLegacyPermission';

export function usePermission(permission: string): boolean {
  const { user } = useAuth();
  const owned = user?.resolvedPermissions ?? [];
  return expandPermissions(owned).includes(permission);
}
```

- [ ] **Step 6: 修改 hasRoutePermission**

修改 `apps/admin/src/config/permissions.ts` 末尾的 `hasRoutePermission`:
```ts
import { expandPermissions } from '../hooks/useLegacyPermission';

export function hasRoutePermission(route: string, resolvedPermissions: string[] = []): boolean {
  const required = ROUTE_PERMISSIONS[route];
  if (!required) return true;
  return expandPermissions(resolvedPermissions).includes(required);
}
```

- [ ] **Step 7: 跑全部 hook 测试**

Run: `cd apps/admin && pnpm test`
Expected: 所有现有测试通过

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/hooks/ apps/admin/src/config/permissions.ts
git commit -m "feat(admin): add LEGACY_PERMISSION_MAP and bidirectional permission check"
```

---

### Task 9: ProductContext + useCurrentProduct

**Files:**
- Create: `apps/admin/src/contexts/ProductContext.tsx`
- Create: `apps/admin/src/hooks/useCurrentProduct.ts`
- Create: `apps/admin/src/contexts/__tests__/ProductContext.test.tsx`

- [ ] **Step 1: 写 failing test**

写到 `apps/admin/src/contexts/__tests__/ProductContext.test.tsx`:
```tsx
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { ProductProvider, useProduct } from '../ProductContext';

function Probe() {
  const { currentProductId, setProduct } = useProduct();
  return (
    <div>
      <span data-testid="current">{currentProductId ?? 'ALL'}</span>
      <button onClick={() => setProduct('codingplan')}>set</button>
    </div>
  );
}

describe('ProductContext', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to ALL (null)', () => {
    render(<ProductProvider><Probe /></ProductProvider>);
    expect(screen.getByTestId('current').textContent).toBe('ALL');
  });

  it('setProduct updates value and persists', () => {
    render(<ProductProvider><Probe /></ProductProvider>);
    act(() => screen.getByText('set').click());
    expect(screen.getByTestId('current').textContent).toBe('codingplan');
    const stored = JSON.parse(localStorage.getItem('admin.currentProduct') ?? '{}');
    expect(stored.value).toBe('codingplan');
  });

  it('restores from localStorage if not expired', () => {
    localStorage.setItem('admin.currentProduct', JSON.stringify({
      value: 'ai-write',
      expiresAt: Date.now() + 1000 * 60 * 60,
    }));
    render(<ProductProvider><Probe /></ProductProvider>);
    expect(screen.getByTestId('current').textContent).toBe('ai-write');
  });

  it('ignores expired localStorage', () => {
    localStorage.setItem('admin.currentProduct', JSON.stringify({
      value: 'expired',
      expiresAt: Date.now() - 1000,
    }));
    render(<ProductProvider><Probe /></ProductProvider>);
    expect(screen.getByTestId('current').textContent).toBe('ALL');
  });
});
```

- [ ] **Step 2: 跑 fail**

Run: `cd apps/admin && pnpm test src/contexts/__tests__/ProductContext.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现 ProductContext**

写到 `apps/admin/src/contexts/ProductContext.tsx`:
```tsx
import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';

const STORAGE_KEY = 'admin.currentProduct';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface Persisted {
  value: string;
  expiresAt: number;
}

interface ProductCtx {
  currentProductId: string | null;
  setProduct: (id: string | null) => void;
  locked: boolean;
  setLocked: (locked: boolean) => void;
}

const Ctx = createContext<ProductCtx | null>(null);

function readPersisted(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Persisted;
    if (parsed.expiresAt < Date.now()) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed.value ?? null;
  } catch {
    return null;
  }
}

function writePersisted(value: string | null) {
  if (value === null) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  const data: Persisted = { value, expiresAt: Date.now() + TTL_MS };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function ProductProvider({ children }: { children: ReactNode }) {
  const [currentProductId, setCurrentProductId] = useState<string | null>(readPersisted);
  const [locked, setLocked] = useState(false);

  const setProduct = useCallback((id: string | null) => {
    setCurrentProductId(id);
    writePersisted(id);
  }, []);

  useEffect(() => {
    // 跨 tab 同步
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setCurrentProductId(readPersisted());
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  return (
    <Ctx.Provider value={{ currentProductId, setProduct, locked, setLocked }}>
      {children}
    </Ctx.Provider>
  );
}

export function useProduct() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useProduct must be inside ProductProvider');
  return ctx;
}
```

写到 `apps/admin/src/hooks/useCurrentProduct.ts`:
```ts
import { useProduct } from '../contexts/ProductContext';

/** 返回 ?productId=xxx 用于 API 查询参数;null = 全部产品 */
export function useCurrentProduct(): string | null {
  return useProduct().currentProductId;
}
```

- [ ] **Step 4: 跑测试**

Run: `cd apps/admin && pnpm test src/contexts/__tests__/ProductContext.test.tsx`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/contexts/ apps/admin/src/hooks/useCurrentProduct.ts
git commit -m "feat(admin): add ProductContext with 7-day localStorage TTL"
```

---

### Task 10: ProductSwitcher 组件

**Files:**
- Create: `apps/admin/src/components/Layout/ProductSwitcher.tsx`
- Create: `apps/admin/src/components/Layout/ProductSwitcher.css`
- Create: `apps/admin/src/components/Layout/__tests__/ProductSwitcher.test.tsx`

- [ ] **Step 1: 写 failing test**

写到 `apps/admin/src/components/Layout/__tests__/ProductSwitcher.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ProductSwitcher } from '../ProductSwitcher';
import { ProductProvider } from '../../../contexts/ProductContext';

const products = [
  { id: 'codingplan', name: 'CodingPlan', billingMode: 'CODING_PLAN' as const },
  { id: 'ai-write', name: 'AI 写作', billingMode: 'PAY_AS_YOU_GO' as const },
];

describe('ProductSwitcher', () => {
  it('shows ALL when no product selected', () => {
    render(<ProductProvider><ProductSwitcher products={products} /></ProductProvider>);
    expect(screen.getByText(/全部产品/)).toBeInTheDocument();
  });

  it('opens dropdown and selects', async () => {
    render(<ProductProvider><ProductSwitcher products={products} /></ProductProvider>);
    fireEvent.click(screen.getByText(/全部产品/));
    fireEvent.click(await screen.findByText('CodingPlan'));
    expect(screen.getByText('CodingPlan')).toBeInTheDocument();
  });

  it('disabled when locked', () => {
    function Wrap() {
      const ctx = require('../../../contexts/ProductContext');
      const { setLocked } = ctx.useProduct();
      setLocked(true);
      return <ProductSwitcher products={products} />;
    }
    // simplification: 测 ProductSwitcher 接收 locked prop
    render(
      <ProductProvider>
        <ProductSwitcher products={products} forceLocked />
      </ProductProvider>,
    );
    const btn = screen.getByText(/全部产品|CodingPlan/).closest('button');
    expect(btn).toBeDisabled();
  });
});
```

- [ ] **Step 2: 跑 fail**

Run: `cd apps/admin && pnpm test src/components/Layout/__tests__/ProductSwitcher.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现**

写到 `apps/admin/src/components/Layout/ProductSwitcher.tsx`:
```tsx
import { useState, useRef, useEffect } from 'react';
import { useProduct } from '../../contexts/ProductContext';
import './ProductSwitcher.css';

export interface ProductOption {
  id: string;
  name: string;
  billingMode: 'SUBSCRIPTION' | 'CODING_PLAN' | 'PAY_AS_YOU_GO';
}

interface ProductSwitcherProps {
  products: ProductOption[];
  forceLocked?: boolean;
}

export function ProductSwitcher({ products, forceLocked }: ProductSwitcherProps) {
  const { currentProductId, setProduct, locked: ctxLocked } = useProduct();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const locked = forceLocked ?? ctxLocked;

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  const current = products.find((p) => p.id === currentProductId);
  const label = current ? current.name : '全部产品';

  return (
    <div className="rt-prod-switcher" ref={ref}>
      <button
        type="button"
        className={`rt-prod-btn ${locked ? 'rt-prod-locked' : ''}`}
        disabled={locked}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="rt-prod-dot" />
        产品: {label} {!locked && '▾'}
      </button>
      {open && !locked && (
        <div className="rt-prod-menu">
          <div
            className="rt-prod-item"
            onClick={() => { setProduct(null); setOpen(false); }}
          >
            全部产品
          </div>
          {products.map((p) => (
            <div
              key={p.id}
              className="rt-prod-item"
              onClick={() => { setProduct(p.id); setOpen(false); }}
            >
              {p.name}
              <span className="rt-prod-mode">{p.billingMode}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

写到 `apps/admin/src/components/Layout/ProductSwitcher.css`:
```css
.rt-prod-switcher { position: relative; }
.rt-prod-btn {
  background: var(--gold-bg);
  border: 1px dashed var(--warning);
  border-radius: var(--radius-pill);
  padding: 5px 12px;
  font-size: var(--fs-sm);
  color: var(--gold-text);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.rt-prod-btn:disabled { cursor: not-allowed; opacity: 0.7; border-style: solid; }
.rt-prod-dot {
  width: 6px; height: 6px; border-radius: var(--radius-pill);
  background: var(--warning);
}
.rt-prod-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-md);
  min-width: 200px;
  z-index: 100;
  overflow: hidden;
}
.rt-prod-item {
  padding: 8px 12px;
  font-size: var(--fs-sm);
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.rt-prod-item:hover { background: var(--bg-hover); }
.rt-prod-mode {
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
```

- [ ] **Step 4: 跑测试**

Run: `cd apps/admin && pnpm test src/components/Layout/__tests__/ProductSwitcher.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/components/Layout/
git commit -m "feat(admin): add ProductSwitcher with honey-gold pill UI"
```

---

### Task 11: 重写 AdminLayout (Sider 240 / 分组 / 顶栏 ProductSwitcher)

**Files:**
- Modify: `apps/admin/src/layouts/AdminLayout.tsx`
- Create: `apps/admin/src/layouts/AdminLayout.css`
- Modify: `apps/admin/src/app.tsx` — 包 ProductProvider

- [ ] **Step 1: 包 ProductProvider**

修改 `apps/admin/src/app.tsx`,在 `<AuthProvider>` 内、`<BrowserRouter>` 外包裹:
```tsx
import { ProductProvider } from './contexts/ProductContext';
// ...
<AuthProvider>
  <ProductProvider>
    <BrowserRouter>
      ...
    </BrowserRouter>
  </ProductProvider>
</AuthProvider>
```

- [ ] **Step 2: 重写 AdminLayout 菜单结构**

完整替换 `apps/admin/src/layouts/AdminLayout.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Outlet, useNavigate, Navigate, useLocation, Link } from 'react-router-dom';
import { Layout, Menu, Dropdown, Button, Spin } from 'antd';
import {
  DashboardOutlined, UserOutlined, AppstoreOutlined, DollarOutlined,
  ApiOutlined, MonitorOutlined, SettingOutlined, LogoutOutlined,
} from '@ant-design/icons';
import { useAuth } from '../store/AuthContext';
import { ROUTE_PERMISSIONS, getDefaultAdminRoute, hasRoutePermission } from '../config/permissions';
import { ProductSwitcher, ProductOption } from '../components/Layout/ProductSwitcher';
import { useProduct } from '../contexts/ProductContext';
import './AdminLayout.css';

const { Sider, Header, Content } = Layout;

interface MenuGroup {
  key: string;
  label: string;
  icon: React.ReactNode;
  items: { key: string; label: string }[];
}

const MENU_GROUPS: MenuGroup[] = [
  { key: 'overview', label: '总览', icon: <DashboardOutlined />, items: [
    { key: '/', label: '运营总览' },
  ]},
  { key: 'users', label: '用户运营', icon: <UserOutlined />, items: [
    { key: '/users', label: '用户列表' },
  ]},
  { key: 'products', label: '产品中心', icon: <AppstoreOutlined />, items: [
    { key: '/products', label: '产品管理' },
    { key: '/plans', label: '套餐与活动' },
    { key: '/api-keys', label: 'ApiKey 管理' },
  ]},
  { key: 'finance', label: '财务中心', icon: <DollarOutlined />, items: [
    { key: '/orders', label: '订单管理' },
    { key: '/usage', label: '用量与流水' },
    { key: '/revenue', label: '收入分析' },
    { key: '/payment-config', label: '支付配置' },
  ]},
  { key: 'ops', label: '模型与渠道', icon: <ApiOutlined />, items: [
    { key: '/channels', label: '渠道管理' },
    { key: '/model-pricing', label: '模型定价' },
  ]},
  { key: 'audit', label: '监控审计', icon: <MonitorOutlined />, items: [
    { key: '/monitoring', label: '实时监控' },
    { key: '/audit-logs', label: '审计日志' },
    { key: '/announcements', label: '公告' },
  ]},
  { key: 'system', label: '系统', icon: <SettingOutlined />, items: [
    { key: '/team', label: '角色与账号' },
    { key: '/feature-flags', label: '功能开关' },
    { key: '/system-prompts', label: '系统提示词' },
    { key: '/system-config', label: '系统设置' },
  ]},
];

const ROUTE_TO_TITLE: Record<string, { group?: string; page: string }> = {};
for (const group of MENU_GROUPS) {
  for (const item of group.items) {
    ROUTE_TO_TITLE[item.key] = { group: group.label, page: item.label };
  }
}

// TODO: 替换为真实 productApi.list,Phase 1 末尾接入
const MOCK_PRODUCTS: ProductOption[] = [
  { id: 'codingplan', name: 'CodingPlan', billingMode: 'CODING_PLAN' },
  { id: 'ai-write', name: 'AI 写作 API', billingMode: 'PAY_AS_YOU_GO' },
  { id: 'ai-chat', name: 'AI 对话 Pro', billingMode: 'SUBSCRIPTION' },
];

export default function AdminLayout() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { setLocked } = useProduct();
  const [products] = useState<ProductOption[]>(MOCK_PRODUCTS);

  // 锁定页面规则
  useEffect(() => {
    const lockedPaths = ['/products/', '/plans/', '/api-keys/'];
    const isLocked = lockedPaths.some((p) => location.pathname.startsWith(p) && location.pathname !== p.slice(0, -1));
    setLocked(isLocked);
  }, [location.pathname, setLocked]);

  const visibleGroups = useMemo(() => {
    const perms = user?.resolvedPermissions ?? [];
    return MENU_GROUPS
      .map((g) => ({
        ...g,
        items: g.items.filter((it) => hasRoutePermission(it.key, perms)),
      }))
      .filter((g) => g.items.length > 0);
  }, [user?.resolvedPermissions]);

  if (loading) {
    return <div className="rt-spin-center"><Spin size="large" /></div>;
  }
  if (!user) return <Navigate to="/login" replace />;

  if (location.pathname === '/') {
    const def = getDefaultAdminRoute(user.resolvedPermissions);
    if (def === '/403') return <Navigate to="/403" replace />;
    if (def !== '/') return <Navigate to={def} replace />;
  }
  if (ROUTE_PERMISSIONS[location.pathname] && !hasRoutePermission(location.pathname, user.resolvedPermissions)) {
    return <Navigate to="/403" replace />;
  }

  const currentInfo = ROUTE_TO_TITLE[location.pathname];

  return (
    <Layout className="rt-shell">
      <Sider width={240} className="rt-sider">
        <div className="rt-brand">睿动 · 管理后台</div>
        <div className="rt-menu">
          {visibleGroups.map((g) => (
            <div key={g.key} className="rt-menu-group">
              <div className="rt-menu-glabel">{g.label}</div>
              {g.items.map((it) => (
                <Link
                  key={it.key}
                  to={it.key}
                  className={`rt-menu-item ${location.pathname === it.key ? 'rt-menu-item-active' : ''}`}
                >
                  {it.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
      </Sider>
      <Layout>
        <Header className="rt-header">
          <div className="rt-crumb">
            {currentInfo && (
              <>
                <span className="rt-crumb-group">{currentInfo.group}</span>
                <span className="rt-crumb-sep"> / </span>
                <span className="rt-crumb-page">{currentInfo.page}</span>
              </>
            )}
          </div>
          <ProductSwitcher products={products} />
          <Dropdown
            menu={{
              items: [{ key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: async () => { await logout(); navigate('/login'); } }],
            }}
          >
            <Button type="text" icon={<UserOutlined />}>{user.nickname || user.email}</Button>
          </Dropdown>
        </Header>
        <Content className="rt-content"><Outlet /></Content>
      </Layout>
    </Layout>
  );
}
```

写到 `apps/admin/src/layouts/AdminLayout.css`:
```css
.rt-shell { min-height: 100vh; }
.rt-sider {
  background: var(--bg-panel) !important;
  border-right: 1px solid var(--border) !important;
}
.rt-brand {
  height: 56px;
  padding: 0 20px;
  display: flex; align-items: center;
  border-bottom: 1px solid var(--border-soft);
  font-weight: 500;
  font-size: var(--fs-md);
  color: var(--primary-dark);
}
.rt-menu { padding: 12px 0; }
.rt-menu-group { margin-bottom: 8px; }
.rt-menu-glabel {
  text-transform: uppercase; letter-spacing: 0.6px;
  color: var(--text-muted);
  font-size: var(--fs-xs);
  padding: 12px 20px 6px;
}
.rt-menu-item {
  display: block;
  padding: 7px 20px;
  color: var(--text);
  font-size: var(--fs-base);
  text-decoration: none;
  border-right: 2px solid transparent;
}
.rt-menu-item:hover { background: var(--bg-hover); }
.rt-menu-item-active {
  background: var(--bg-active);
  color: var(--primary);
  font-weight: 500;
  border-right-color: var(--primary);
}
.rt-header {
  background: var(--bg-panel) !important;
  border-bottom: 1px solid var(--border) !important;
  padding: 0 20px !important;
  display: flex; align-items: center; gap: 12px;
  height: 56px;
}
.rt-crumb {
  flex: 1; font-size: var(--fs-base);
}
.rt-crumb-group { color: var(--text-secondary); }
.rt-crumb-sep { color: var(--text-muted); margin: 0 4px; }
.rt-crumb-page { color: var(--text); font-weight: 500; }
.rt-content {
  background: var(--bg-body);
  padding: 20px;
  min-height: 0;
}
.rt-spin-center {
  display: flex; justify-content: center; align-items: center; height: 100vh;
}
```

- [ ] **Step 3: 跑 dev 验证**

```bash
cd apps/admin && pnpm dev
```
打开 http://localhost:5174 验证:
- 侧栏 240px,分组 + 大写小标签
- 顶栏面包屑 + 蜂蜜金虚线胶囊产品筛选器 + 用户菜单
- 激活态深海蓝,右侧 2px 竖条

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/layouts/ apps/admin/src/app.tsx
git commit -m "feat(admin): redesign AdminLayout with sidebar groups + product switcher"
```

---

### Task 12: 重排路由表 (合并 + 新增 + 删除)

**Files:**
- Modify: `apps/admin/src/app.tsx`
- Modify: `apps/admin/src/config/permissions.ts`
- Create: `apps/admin/src/pages/ApiKeys/index.tsx` (占位)

- [ ] **Step 1: 创建 ApiKeys 占位页**

写到 `apps/admin/src/pages/ApiKeys/index.tsx`:
```tsx
import { PageHeader } from '../../components/common';

export default function ApiKeysPage() {
  return (
    <PageHeader
      title="ApiKey 管理"
      subtitle="所有产品的 API Key 统一管理 (功能开发中)"
    />
  );
}
```

- [ ] **Step 2: 修改路由表**

修改 `apps/admin/src/app.tsx`:

(a) 删除 `ModelAccessPage` 的 `lazy import` 和它的 `<Route>`
(b) 把 `BoosterPacksPage / CampaignsPage / DiscountCodesPage / PlanTemplatesPage` 全部映射到 `/plans` 单一路由 (4 个 import 保留,但只在 `/plans/legacy/{...}` 兜底,主路由用 PlanTemplatesPage 兼容)
(c) 把 `MembersPage / RolesPage` 都挂 `/team` (主显示 RolesPage 容器,MembersPage 在内部 Tab 渲染) — 此 Task 只调整路由,合并 UI 在后续 Task
(d) 把 `SessionsPage / MonitoringPage` 都挂 `/monitoring`
(e) 新增 `<Route path="/api-keys" element={<ApiKeysPage />} />`
(f) 新增 `<Route path="/usage" element={<TransactionsPage />} />` (合并占位,UI 改造在后续 Task)

只调整路由层,各 page 内部 UI 保持现状 (避免本 Task 范围爆炸)。

具体改动写到 app.tsx Routes 内 (替换匹配段):

```tsx
const ApiKeysPage = lazy(() => import('./pages/ApiKeys'));

// 在 Routes 内,删除/添加:
// 删除: <Route path="/model-access" ... />
// 删除: <Route path="/booster-packs" ... />
// 删除: <Route path="/campaigns" ... />
// 删除: <Route path="/discount-codes" ... />
// 删除: <Route path="/sessions" ... />
// 删除: <Route path="/transactions" ... />
// 删除: <Route path="/roles" ... />
// 删除: <Route path="/members" ... />

// 替换 /plan-templates 为 /plans:
<Route path="/plans" element={<PlanTemplatesPage />} />
<Route path="/plans/:id" element={<PlanDetailPage />} />

// 新增:
<Route path="/api-keys" element={<ApiKeysPage />} />
<Route path="/usage" element={<TransactionsPage />} />
<Route path="/monitoring" element={<MonitoringPage />} />
<Route path="/team" element={<RolesPage />} />

// 旧路径重定向 (向后兼容):
<Route path="/plan-templates" element={<Navigate to="/plans" replace />} />
<Route path="/plan-templates/:id" element={<Navigate to="/plans/:id" replace />} />  // params 透传
<Route path="/transactions" element={<Navigate to="/usage" replace />} />
<Route path="/sessions" element={<Navigate to="/monitoring" replace />} />
<Route path="/roles" element={<Navigate to="/team" replace />} />
<Route path="/members" element={<Navigate to="/team" replace />} />
<Route path="/booster-packs" element={<Navigate to="/plans" replace />} />
<Route path="/campaigns" element={<Navigate to="/plans" replace />} />
<Route path="/discount-codes" element={<Navigate to="/plans" replace />} />
<Route path="/model-access" element={<Navigate to="/plans" replace />} />
```

- [ ] **Step 3: 修改 ROUTE_PERMISSIONS**

修改 `apps/admin/src/config/permissions.ts` 的 `ROUTE_PERMISSIONS`:
```ts
export const ROUTE_PERMISSIONS: Record<string, string> = {
  '/': 'admin.dashboard',
  '/users': 'admin.users.view',
  '/team': 'admin.members.manage',
  '/products': 'admin.plans.view',
  '/plans': 'admin.plans.view',
  '/plans/new': 'admin.plans.manage',
  '/api-keys': 'admin.plans.view',  // 复用,后续按需细分
  '/channels': 'admin.channels.view',
  '/model-pricing': 'admin.plans.manage',
  '/orders': 'admin.orders.view',
  '/usage': 'admin.transactions.view',
  '/revenue': 'admin.revenue.view',
  '/payment-config': 'admin.system.manage',
  '/monitoring': 'admin.monitoring.view',
  '/audit-logs': 'admin.audit.view',
  '/announcements': 'admin.announcements.manage',
  '/feature-flags': 'admin.system.manage',
  '/system-prompts': 'admin.system.manage',
  '/system-config': 'admin.system.manage',
};

export const ADMIN_ROUTE_ORDER = [
  '/', '/users', '/products', '/plans', '/api-keys',
  '/orders', '/usage', '/revenue', '/payment-config',
  '/channels', '/model-pricing',
  '/monitoring', '/audit-logs', '/announcements',
  '/team', '/feature-flags', '/system-prompts', '/system-config',
] as const;
```

- [ ] **Step 4: 跑 dev 验证**

打开浏览器,访问 `/team`、`/plans`、`/api-keys`、`/usage`、`/monitoring`,确认页面能打开;访问旧路径 `/transactions`、`/sessions` 自动重定向;`/model-access` 重定向到 `/plans`。

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/app.tsx apps/admin/src/config/permissions.ts apps/admin/src/pages/ApiKeys/
git commit -m "feat(admin): consolidate routes (27 → 21) with backward-compat redirects"
```

---

### Task 13: 接入真实 productApi 替换 MOCK_PRODUCTS

**Files:**
- Modify: `apps/admin/src/api/admin.ts`
- Modify: `apps/admin/src/layouts/AdminLayout.tsx`

- [ ] **Step 1: 检查后端 productApi 是否存在**

```bash
grep -r "productApi\|/api/admin/products" /Users/shineli/ruidong/codesphere-admin-saas/apps/admin/src/api/
```

- [ ] **Step 2: 如果不存在,加 productApi.list**

修改 `apps/admin/src/api/admin.ts` 末尾,新增:
```ts
export const productApi = {
  list: () => http.get<{ items: Array<{ id: string; name: string; billingMode: 'SUBSCRIPTION' | 'CODING_PLAN' | 'PAY_AS_YOU_GO'; isActive: boolean }> }>('/admin/products'),
};
```

(具体的 http 客户端引用按现有 axios.ts 风格,如果是 `import { http } from './axios'` 则保持一致)

- [ ] **Step 3: 在 AdminLayout 用 productApi 替换 MOCK**

修改 `apps/admin/src/layouts/AdminLayout.tsx`,删除 `MOCK_PRODUCTS`,改为:
```tsx
const [products, setProducts] = useState<ProductOption[]>([]);

useEffect(() => {
  productApi.list().then((res) => {
    const items = (res.items ?? [])
      .filter((p) => p.isActive)
      .map((p) => ({ id: p.id, name: p.name, billingMode: p.billingMode }));
    setProducts(items);
  }).catch(() => {
    // 静默失败,fallback 到空列表
  });
}, []);
```

- [ ] **Step 4: 验证**

```bash
cd apps/admin && pnpm dev
```
打开 http://localhost:5174,产品筛选器下拉显示真实产品列表。

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/api/admin.ts apps/admin/src/layouts/AdminLayout.tsx
git commit -m "feat(admin): wire ProductSwitcher to productApi.list"
```

---

## Phase 2: 5 个样板页面

### Task 14: Dashboard 重做

**Files:**
- Modify: `apps/admin/src/pages/Dashboard/index.tsx`
- Create: `apps/admin/src/pages/Dashboard/Dashboard.css`

- [ ] **Step 1: 完整替换 Dashboard 页面**

替换 `apps/admin/src/pages/Dashboard/index.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Spin } from 'antd';
import { PageHeader, StatCard, StatCardGroup } from '../../components/common';
import { dashboardApi } from '../../api/admin';
import { useCurrentProduct } from '../../hooks/useCurrentProduct';
import './Dashboard.css';

interface Stats {
  userCount: number;
  orderCount: number;
  paidOrderCount: number;
  totalRevenueCents: number;
  channelCount: number;
  activeKeyCount: number;
}

export default function DashboardPage() {
  const productId = useCurrentProduct();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    dashboardApi.stats(productId ? { productId } : undefined)
      .then(setStats)
      .finally(() => setLoading(false));
  }, [productId]);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!stats) return null;

  const scope = productId ? `产品: ${productId}` : '全部产品';

  return (
    <div>
      <PageHeader
        title="运营总览"
        subtitle={`当前范围: ${scope} · 近 30 天`}
      />

      <StatCardGroup>
        <StatCard label="总用户" value={stats.userCount} />
        <StatCard label="活跃订阅" value={stats.paidOrderCount} />
        <StatCard label="本月收入" value={`¥${(stats.totalRevenueCents / 100).toLocaleString('zh-CN')}`} />
        <StatCard label="渠道数" value={stats.channelCount} />
      </StatCardGroup>

      <div className="rt-dash-row-2-1">
        <section className="rt-panel">
          <header><h3>收入趋势</h3><span className="rt-panel-sub">按产品拆分 · 近 30 天</span></header>
          <div className="rt-chart-placeholder">
            趋势图待接入 (Phase 3 财务补齐)
          </div>
        </section>
        <section className="rt-panel">
          <header><h3>产品贡献</h3><span className="rt-panel-sub">按收入排序</span></header>
          <div className="rt-list-placeholder">
            产品收入列表待接入 (Phase 3)
          </div>
        </section>
      </div>

      <div className="rt-dash-row-1-1">
        <section className="rt-panel">
          <header><h3>最近订单</h3><Link to="/orders" className="rt-link">查看全部</Link></header>
          <div className="rt-list-placeholder">最新 5 笔订单待接入</div>
        </section>
        <section className="rt-panel">
          <header><h3>系统告警</h3><Link to="/audit-logs" className="rt-link">审计日志</Link></header>
          <div className="rt-list-placeholder">未处理告警列表</div>
        </section>
      </div>
    </div>
  );
}
```

写到 `apps/admin/src/pages/Dashboard/Dashboard.css`:
```css
.rt-dash-row-2-1 {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 14px;
  margin-bottom: 14px;
}
.rt-dash-row-1-1 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.rt-panel {
  background: var(--bg-panel);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-card);
  padding: 14px;
}
.rt-panel header {
  display: flex; justify-content: space-between; align-items: baseline;
  margin-bottom: 10px;
}
.rt-panel header h3 { font-size: var(--fs-base); font-weight: 500; color: var(--primary-dark); margin: 0; }
.rt-panel-sub { font-size: var(--fs-xs); color: var(--text-muted); }
.rt-chart-placeholder, .rt-list-placeholder {
  height: 160px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-muted);
  font-size: var(--fs-sm);
  background: rgba(14, 42, 71, 0.02);
  border-radius: 6px;
}
.rt-link { color: var(--primary); text-decoration: none; font-size: var(--fs-sm); }
.rt-link:hover { text-decoration: underline; }
```

- [ ] **Step 2: 跑 dev 验证**

打开 http://localhost:5174,确认 Dashboard 重做后视觉与第 5 节 mockup 一致。

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/pages/Dashboard/
git commit -m "feat(admin): redesign Dashboard with PageHeader + StatCardGroup + 4 panels"
```

---

### Task 15: Users 列表重做

**Files:**
- Modify: `apps/admin/src/pages/Users/index.tsx`

- [ ] **Step 1: 完整替换 Users 页面**

替换 `apps/admin/src/pages/Users/index.tsx`:
```tsx
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Modal, Input, Form, Switch, message, Select } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { PageHeader, StatCard, StatCardGroup, FilterBar, DataTable, Tag } from '../../components/common';
import { userManageApi } from '../../api/admin';
import { usePermission } from '../../hooks/usePermission';

interface UserRecord {
  id: string;
  email: string;
  phone?: string;
  nickname?: string;
  isActive: boolean;
  createdAt: string;
  subscriptions?: { plan: { id: string; name: string }; status: string }[];
  apiKeyCount?: number;
}

interface SearchParams {
  search?: string; status?: string; provider?: string;
  page?: number; pageSize?: number;
}

export default function UsersPage() {
  const navigate = useNavigate();
  const canManage = usePermission('users.manage');
  const [data, setData] = useState<{ items: UserRecord[]; total: number }>({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [params, setParams] = useState<SearchParams>({ page: 1, pageSize: 20 });
  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createForm] = Form.useForm();

  const fetchUsers = useCallback(async (p: SearchParams) => {
    setLoading(true);
    try {
      const res = await userManageApi.search(p);
      setData(res);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers(params);
  }, [params, fetchUsers]);

  const items = data.items ?? [];
  const totalActive = items.filter((u) => u.isActive).length;
  const noSub = items.filter((u) => !u.subscriptions?.length).length;

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      setCreateLoading(true);
      await userManageApi.create(values);
      message.success('邀请已发送');
      setCreateOpen(false);
      createForm.resetFields();
      fetchUsers(params);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error('创建失败');
    } finally {
      setCreateLoading(false);
    }
  };

  const columns = [
    {
      title: '邮箱 / 昵称', dataIndex: 'email', key: 'email',
      render: (_: unknown, r: UserRecord) => (
        <div>
          <div>{r.email}</div>
          {r.nickname && <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{r.nickname}</div>}
        </div>
      ),
    },
    {
      title: '当前订阅', key: 'subs',
      render: (_: unknown, r: UserRecord) => {
        const subs = r.subscriptions ?? [];
        if (subs.length === 0) return <Tag variant="muted">—</Tag>;
        return (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {subs.map((s) => <Tag key={s.plan.id} variant="muted">{s.plan.name}</Tag>)}
          </div>
        );
      },
    },
    {
      title: 'API Key', dataIndex: 'apiKeyCount', key: 'keys',
      render: (n: number | undefined) => n ? `${n} 把` : '—',
    },
    {
      title: '状态', dataIndex: 'isActive', key: 'isActive',
      render: (active: boolean) => active ? <Tag variant="success">启用</Tag> : <Tag variant="error">停用</Tag>,
    },
    {
      title: '注册时间', dataIndex: 'createdAt', key: 'createdAt',
      render: (t: string) => new Date(t).toLocaleDateString('zh-CN'),
    },
    {
      title: '操作', key: 'op', align: 'right' as const,
      render: (_: unknown, r: UserRecord) => (
        <Button type="link" size="small" onClick={() => navigate(`/users/${r.id}`)}>查看</Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="用户管理"
        subtitle="查看和管理睿动平台所有注册用户"
        actions={[
          <Button key="exp" type="default">导出 CSV</Button>,
          <Button key="inv" type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)} disabled={!canManage}>邀请用户</Button>,
        ]}
      />

      <StatCardGroup>
        <StatCard label="当前结果" value={data.total} />
        <StatCard label="本页启用" value={totalActive} variant="success" />
        <StatCard label="缺少订阅" value={noSub} variant="warning" />
        <StatCard label="本月新增" value="—" />
      </StatCardGroup>

      <FilterBar
        search={{
          placeholder: '搜索邮箱 / 昵称 / ID',
          onSearch: (v) => setParams((p) => ({ ...p, search: v || undefined, page: 1 })),
        }}
        filters={[
          <Select
            key="status"
            defaultValue="all"
            style={{ width: 120 }}
            onChange={(v) => setParams((p) => ({ ...p, status: v === 'all' ? undefined : v, page: 1 }))}
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'active', label: '启用' },
              { value: 'inactive', label: '停用' },
            ]}
          />,
          <Select
            key="provider"
            defaultValue="all"
            style={{ width: 120 }}
            onChange={(v) => setParams((p) => ({ ...p, provider: v === 'all' ? undefined : v, page: 1 }))}
            options={[
              { value: 'all', label: '全部来源' },
              { value: 'auth0', label: 'Auth0' },
              { value: 'local', label: '本地注册' },
            ]}
          />,
        ]}
      />

      <DataTable<UserRecord>
        columns={columns}
        dataSource={items}
        rowKey="id"
        loading={loading}
        pagination={{
          current: params.page,
          total: data.total,
          pageSize: params.pageSize ?? 20,
          onChange: (p) => setParams((prev) => ({ ...prev, page: p })),
          showTotal: (t) => `共 ${t} 条`,
        }}
      />

      <Modal
        title="邀请用户"
        open={createOpen}
        onOk={handleCreate}
        onCancel={() => { setCreateOpen(false); createForm.resetFields(); }}
        confirmLoading={createLoading}
        okText="发送邀请"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={createForm} layout="vertical">
          <Form.Item label="邮箱" name="email" rules={[
            { required: true, message: '请输入邮箱' },
            { type: 'email', message: '请输入有效邮箱' },
          ]}>
            <Input placeholder="user@example.com" />
          </Form.Item>
          <Form.Item label="昵称" name="nickname">
            <Input placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 2: 跑 dev 验证**

http://localhost:5174/users —— 验证布局符合第 5 节 mockup。

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/pages/Users/
git commit -m "feat(admin): redesign Users list with new common components"
```

---

### Task 16: UserDetail 重做 — 主壳 + Tabs

**Files:**
- Modify: `apps/admin/src/pages/UserDetail/index.tsx`

- [ ] **Step 1: 重写 UserDetail 主壳 (产品卡组件留 Task 17/18 实现)**

完整替换 `apps/admin/src/pages/UserDetail/index.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Tabs, Spin, Button, message } from 'antd';
import { PageHeader, Tag } from '../../components/common';
import { userManageApi } from '../../api/admin';

interface UserDetailData {
  id: string;
  email: string;
  nickname?: string;
  phone?: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt?: string | null;
  realname?: { verified: boolean; name?: string };
  identityProvider?: string;
  subscriptions?: Array<{
    productId: string;
    productName: string;
    billingMode: 'SUBSCRIPTION' | 'CODING_PLAN' | 'PAY_AS_YOU_GO';
    plan: { id: string; name: string };
    status: string;
  }>;
  // 其他字段后续接入
}

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<UserDetailData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    userManageApi.get(id).then(setData).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!data) return null;

  const handleResetPassword = async () => {
    try {
      const res = await userManageApi.resetPassword(data.id);
      message.success(`临时密码: ${res.tempPassword ?? res.password}`);
    } catch {
      message.error('重置密码失败');
    }
  };

  const subtitle = `注册 ${new Date(data.createdAt).toLocaleDateString('zh-CN')}${data.lastLoginAt ? ` · 最近登录 ${new Date(data.lastLoginAt).toLocaleString('zh-CN')}` : ''}`;

  return (
    <div>
      <PageHeader
        title={data.email}
        subtitle={subtitle}
        breadcrumb={[{ label: '用户列表', to: '/users' }, '用户详情']}
        actions={[
          <Button key="reset" onClick={handleResetPassword}>重置密码</Button>,
          <Button key="exp">导出账户</Button>,
          <Button key="ban" danger>封禁账号</Button>,
        ]}
      />

      <div className="rt-uid-card">
        <div className="rt-uid-avatar">{(data.nickname || data.email).slice(0, 1).toUpperCase()}</div>
        <div className="rt-uid-meta">
          <div className="rt-uid-name">{data.nickname || '—'}</div>
          <div className="rt-uid-id">{data.phone ? `${data.phone} · ` : ''}ID {data.id.slice(0, 8)}...</div>
        </div>
        <div className="rt-uid-badges">
          {data.realname?.verified && <Tag variant="success">已实名</Tag>}
          {data.identityProvider && <Tag variant="muted">{data.identityProvider}</Tag>}
          {data.isActive ? <Tag variant="success">启用</Tag> : <Tag variant="error">停用</Tag>}
        </div>
      </div>

      <Tabs
        defaultActiveKey="account"
        items={[
          { key: 'account', label: '账户与额度', children: <AccountTab subscriptions={data.subscriptions ?? []} userId={data.id} /> },
          { key: 'orders', label: '订单', children: <div>订单 (复用 Orders 组件,锁定 userId={data.id})</div> },
          { key: 'usage', label: '用量与流水', children: <div>用量与流水 (待接入 Usage 视图)</div> },
          { key: 'keys', label: 'API Key', children: <div>API Key 列表 (跨产品)</div> },
          { key: 'audit', label: '操作记录', children: <div>对该用户的操作日志</div> },
        ]}
      />

      <style>{`
        .rt-uid-card {
          background: var(--bg-panel);
          border: 1px solid var(--border-soft);
          border-radius: var(--radius-card);
          padding: 14px 16px;
          margin-bottom: 14px;
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 16px;
          align-items: center;
        }
        .rt-uid-avatar {
          width: 48px; height: 48px;
          border-radius: var(--radius-pill);
          background: linear-gradient(135deg, var(--primary), var(--info));
          color: var(--bg-panel);
          display: flex; align-items: center; justify-content: center;
          font-size: var(--fs-lg); font-weight: 500;
        }
        .rt-uid-name { font-size: var(--fs-md); font-weight: 500; color: var(--primary-dark); }
        .rt-uid-id { font-size: var(--fs-sm); color: var(--text-secondary); margin-top: 3px; }
        .rt-uid-badges { display: flex; gap: 6px; }
      `}</style>
    </div>
  );
}

import { ProductAccountCard } from './ProductAccountCard';

function AccountTab({ subscriptions, userId }: { subscriptions: UserDetailData['subscriptions']; userId: string }) {
  if (!subscriptions || subscriptions.length === 0) {
    return (
      <div className="rt-empty">
        <p>该用户尚未订阅或购买任何产品</p>
        <Button>手动开通</Button>
        <Button>赠送试用</Button>
      </div>
    );
  }
  return (
    <div className={`rt-acc-grid rt-acc-grid-${subscriptions.length}`}>
      {subscriptions.map((s) => (
        <ProductAccountCard key={s.productId} subscription={s} userId={userId} />
      ))}
      <style>{`
        .rt-acc-grid {
          display: grid;
          gap: 12px;
        }
        .rt-acc-grid-1 { grid-template-columns: 1fr; }
        .rt-acc-grid-2, .rt-acc-grid-3, .rt-acc-grid-4 { grid-template-columns: 1fr 1fr; }
        .rt-empty {
          padding: 60px 20px;
          text-align: center;
          color: var(--text-muted);
        }
        .rt-empty .ant-btn { margin: 0 4px; }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: 创建 ProductAccountCard 调度器 (具体卡 Task 17 实现,先占位)**

写到 `apps/admin/src/pages/UserDetail/ProductAccountCard.tsx`:
```tsx
interface Subscription {
  productId: string;
  productName: string;
  billingMode: 'SUBSCRIPTION' | 'CODING_PLAN' | 'PAY_AS_YOU_GO';
  plan: { id: string; name: string };
  status: string;
}

interface Props {
  subscription: Subscription;
  userId: string;
}

export function ProductAccountCard({ subscription, userId }: Props) {
  return (
    <div style={{
      background: 'var(--bg-panel)',
      border: '1px solid var(--border-soft)',
      borderRadius: 'var(--radius-card)',
      padding: 14,
    }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--primary-dark)' }}>
        {subscription.productName} <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{subscription.billingMode}</span>
      </div>
      <div style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: 12 }}>
        套餐 {subscription.plan.name} (具体内容由 Task 17 渲染三种卡)
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 跑 dev 验证**

打开 http://localhost:5174/users 选一个用户进入详情。

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/pages/UserDetail/
git commit -m "feat(admin): redesign UserDetail shell with tabs + identity card"
```

---

### Task 17: UserDetail 三种产品卡

**Files:**
- Create: `apps/admin/src/pages/UserDetail/CodingPlanCard.tsx`
- Create: `apps/admin/src/pages/UserDetail/SubscriptionCard.tsx`
- Create: `apps/admin/src/pages/UserDetail/PayAsYouGoCard.tsx`
- Modify: `apps/admin/src/pages/UserDetail/ProductAccountCard.tsx`
- Create: `apps/admin/src/pages/UserDetail/cards.css`
- Create: `apps/admin/src/pages/UserDetail/__tests__/cards.test.tsx`

- [ ] **Step 1: 写 failing test**

写到 `apps/admin/src/pages/UserDetail/__tests__/cards.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CodingPlanCard } from '../CodingPlanCard';
import { SubscriptionCard } from '../SubscriptionCard';
import { PayAsYouGoCard } from '../PayAsYouGoCard';

describe('CodingPlanCard', () => {
  it('renders quotas with progress bars', () => {
    render(
      <CodingPlanCard
        productName="CodingPlan Pro"
        quotas={[
          { windowType: 'ROLLING', durationLabel: '5h', used: 6, limit: 10, metric: 'requests' },
          { windowType: 'ROLLING', durationLabel: '7d', used: 120, limit: 400, metric: 'requests' },
        ]}
        keys={[]}
        onAddKey={() => {}}
        onRenew={() => {}}
      />,
    );
    expect(screen.getByText(/CodingPlan Pro/)).toBeInTheDocument();
    expect(screen.getByText(/6 \/ 10/)).toBeInTheDocument();
    expect(screen.getByText(/120 \/ 400/)).toBeInTheDocument();
  });

  it('marks near-limit quota with warn style', () => {
    const { container } = render(
      <CodingPlanCard
        productName="x"
        quotas={[{ windowType: 'CUMULATIVE', durationLabel: '30d', used: 1840, limit: 2000, metric: 'requests' }]}
        keys={[]}
        onAddKey={() => {}}
        onRenew={() => {}}
      />,
    );
    expect(container.querySelector('.rt-quota-fill-warn')).not.toBeNull();
  });
});

describe('SubscriptionCard', () => {
  it('renders plan + booster + total', () => {
    render(
      <SubscriptionCard
        productName="AI 对话 Pro"
        planCredits={{ used: 3800, total: 5000 }}
        boosterCredits={300}
        onRenew={() => {}}
        onBuyBooster={() => {}}
      />,
    );
    expect(screen.getByText(/AI 对话 Pro/)).toBeInTheDocument();
    expect(screen.getByText(/1,200/)).toBeInTheDocument(); // 5000 - 3800 = 1,200
    expect(screen.getByText(/\+300/)).toBeInTheDocument();
    expect(screen.getByText(/1,500/)).toBeInTheDocument(); // total
  });
});

describe('PayAsYouGoCard', () => {
  it('renders balance + month usage + key list', () => {
    render(
      <PayAsYouGoCard
        productName="AI 写作"
        balanceCents={23450}
        monthUsageCents={4520}
        keys={[
          { id: 'k1', prefix: 'write_live_***c4d8', lastUsedAt: '2 mins ago', monthUsageCents: 1820, isActive: true },
        ]}
        onAddKey={() => {}}
        onRecharge={() => {}}
      />,
    );
    expect(screen.getByText(/AI 写作/)).toBeInTheDocument();
    expect(screen.getByText(/¥234.50/)).toBeInTheDocument();
    expect(screen.getByText(/¥45.20/)).toBeInTheDocument();
    expect(screen.getByText(/write_live_\*\*\*c4d8/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑 fail**

Run: `cd apps/admin && pnpm test src/pages/UserDetail/__tests__/cards.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现三个卡**

写到 `apps/admin/src/pages/UserDetail/cards.css`:
```css
.rt-pcard {
  background: var(--bg-panel);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-card);
  padding: 14px;
}
.rt-pcard-h { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.rt-pcard-t { font-size: var(--fs-base); font-weight: 500; color: var(--primary-dark); }
.rt-pcard-s { font-size: var(--fs-xs); color: var(--text-muted); }

.rt-quota { margin: 8px 0; }
.rt-quota-row { display: flex; justify-content: space-between; font-size: var(--fs-xs); color: var(--text-secondary); margin-bottom: 4px; }
.rt-quota-bar { height: 6px; background: rgba(14, 42, 71, 0.08); border-radius: var(--radius-pill); overflow: hidden; }
.rt-quota-fill { height: 100%; background: var(--primary); }
.rt-quota-fill-warn { background: var(--warning); }
.rt-quota-fill-error { background: var(--error); }

.rt-keys { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border-divider); }
.rt-keys-h { font-size: var(--fs-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 8px; }
.rt-keys-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; font-size: var(--fs-sm); }
.rt-keys-name { font-family: var(--font-mono); color: var(--text); }
.rt-keys-meta { font-size: var(--fs-xs); color: var(--text-muted); }
.rt-keys-link { color: var(--primary); text-decoration: underline; cursor: pointer; }

.rt-balance-row { display: flex; justify-content: space-between; align-items: baseline; padding: 10px 0; border-top: 1px dashed var(--border-divider); margin-top: 8px; }
.rt-balance-row:first-of-type { border-top: none; padding-top: 0; }
.rt-balance-lbl { color: var(--text-secondary); font-size: var(--fs-sm); }
.rt-balance-val { color: var(--primary-dark); font-size: var(--fs-lg); font-weight: 500; font-variant-numeric: tabular-nums; }
.rt-balance-val-gold { color: var(--warning); }

.rt-actions-row { margin-top: 12px; display: flex; gap: 6px; }
```

写到 `apps/admin/src/pages/UserDetail/CodingPlanCard.tsx`:
```tsx
import { Button } from 'antd';
import { Tag } from '../../../components/common';
import './cards.css';

interface QuotaRow {
  windowType: 'ROLLING' | 'FIXED_PERIOD' | 'CUMULATIVE';
  durationLabel: string;
  used: number;
  limit: number;
  metric: 'requests' | 'tokens' | 'credits';
}

interface KeyRow {
  id: string;
  prefix: string;
  lastUsedAt?: string;
  isActive: boolean;
}

interface Props {
  productName: string;
  resetAt?: string;
  quotas: QuotaRow[];
  keys: KeyRow[];
  onAddKey: () => void;
  onRenew: () => void;
  onAddQuota?: () => void;
}

const metricLabel = { requests: '请求', tokens: 'tokens', credits: '积分' };

export function CodingPlanCard({ productName, resetAt, quotas, keys, onAddKey, onRenew, onAddQuota }: Props) {
  return (
    <div className="rt-pcard">
      <div className="rt-pcard-h">
        <div className="rt-pcard-t">{productName} <Tag variant="muted">订阅 + 配额</Tag></div>
        {resetAt && <div className="rt-pcard-s">下次重置 {resetAt}</div>}
      </div>

      {quotas.map((q, i) => {
        const pct = Math.min(100, (q.used / q.limit) * 100);
        const fillClass = pct >= 90 ? 'rt-quota-fill-error' : pct >= 80 ? 'rt-quota-fill-warn' : '';
        return (
          <div key={i} className="rt-quota">
            <div className="rt-quota-row">
              <span>{q.durationLabel} {q.windowType === 'ROLLING' ? '滚动' : q.windowType === 'FIXED_PERIOD' ? '周期' : '累计'}</span>
              <span>{q.used.toLocaleString('zh-CN')} / {q.limit.toLocaleString('zh-CN')} {metricLabel[q.metric]}</span>
            </div>
            <div className="rt-quota-bar">
              <div className={`rt-quota-fill ${fillClass}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}

      <div className="rt-keys">
        <div className="rt-keys-h">此产品下的 API Key ({keys.length} 把)</div>
        {keys.map((k) => (
          <div key={k.id} className="rt-keys-row">
            <div>
              <div className="rt-keys-name">{k.prefix}</div>
              <div className="rt-keys-meta">{k.lastUsedAt ?? '未使用'} · {k.isActive ? '启用' : '停用'}</div>
            </div>
            <span className="rt-keys-link">详情</span>
          </div>
        ))}
      </div>

      <div className="rt-actions-row">
        <Button onClick={onAddKey}>+ 新建 Key</Button>
        <Button onClick={onRenew}>续费</Button>
        {onAddQuota && <Button onClick={onAddQuota}>手动加配额</Button>}
      </div>
    </div>
  );
}
```

写到 `apps/admin/src/pages/UserDetail/SubscriptionCard.tsx`:
```tsx
import { Button } from 'antd';
import { Tag } from '../../../components/common';
import './cards.css';

interface Props {
  productName: string;
  remainingDays?: number;
  planCredits: { used: number; total: number };
  boosterCredits: number;
  onRenew: () => void;
  onBuyBooster: () => void;
  onAddCredits?: () => void;
}

export function SubscriptionCard({ productName, remainingDays, planCredits, boosterCredits, onRenew, onBuyBooster, onAddCredits }: Props) {
  const planRemaining = Math.max(0, planCredits.total - planCredits.used);
  const total = planRemaining + boosterCredits;

  return (
    <div className="rt-pcard">
      <div className="rt-pcard-h">
        <div className="rt-pcard-t">{productName} <Tag variant="muted">订阅</Tag></div>
        {remainingDays !== undefined && <div className="rt-pcard-s">本月剩余 {remainingDays} 天</div>}
      </div>

      <div className="rt-balance-row">
        <span className="rt-balance-lbl">套餐积分</span>
        <span className="rt-balance-val">{planRemaining.toLocaleString('zh-CN')} <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>/ {planCredits.total.toLocaleString('zh-CN')}</span></span>
      </div>
      <div className="rt-balance-row">
        <span className="rt-balance-lbl">加油包积分</span>
        <span className="rt-balance-val rt-balance-val-gold">+{boosterCredits.toLocaleString('zh-CN')}</span>
      </div>
      <div className="rt-balance-row" style={{ borderTop: '1px solid var(--border)' }}>
        <span className="rt-balance-lbl">合计可用</span>
        <span className="rt-balance-val">{total.toLocaleString('zh-CN')}</span>
      </div>

      <div className="rt-actions-row">
        <Button onClick={onRenew}>续费</Button>
        <Button onClick={onBuyBooster}>买加油包</Button>
        {onAddCredits && <Button onClick={onAddCredits}>手动加积分</Button>}
      </div>
    </div>
  );
}
```

写到 `apps/admin/src/pages/UserDetail/PayAsYouGoCard.tsx`:
```tsx
import { Button } from 'antd';
import { Tag } from '../../../components/common';
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
  balanceCents: number;
  monthUsageCents: number;
  keys: KeyRow[];
  onAddKey: () => void;
  onRecharge: () => void;
  onAdjustBalance?: () => void;
}

const formatCents = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

export function PayAsYouGoCard({ productName, balanceCents, monthUsageCents, keys, onAddKey, onRecharge, onAdjustBalance }: Props) {
  return (
    <div className="rt-pcard" style={{ gridColumn: 'span 2' }}>
      <div className="rt-pcard-h">
        <div className="rt-pcard-t">{productName} <Tag variant="muted">按量付费</Tag></div>
        <div className="rt-pcard-s">本月用量 {formatCents(monthUsageCents)}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginTop: 6 }}>
        <div className="rt-balance-row" style={{ borderTop: 'none', padding: 0 }}>
          <span className="rt-balance-lbl">预付余额</span>
          <span className="rt-balance-val">{formatCents(balanceCents)}</span>
        </div>
        <div className="rt-balance-row" style={{ borderTop: 'none', padding: 0 }}>
          <span className="rt-balance-lbl">本月用量</span>
          <span className="rt-balance-val">{formatCents(monthUsageCents)}</span>
        </div>
        <div className="rt-balance-row" style={{ borderTop: 'none', padding: 0 }}>
          <span className="rt-balance-lbl">活跃 Key</span>
          <span className="rt-balance-val">{keys.filter((k) => k.isActive).length}</span>
        </div>
      </div>

      <div className="rt-keys">
        <div className="rt-keys-h">此产品下的 API Key ({keys.length} 把)</div>
        {keys.map((k) => (
          <div key={k.id} className="rt-keys-row">
            <div>
              <div className="rt-keys-name">{k.prefix}</div>
              <div className="rt-keys-meta">{k.lastUsedAt ?? '未使用'} · {k.isActive ? '启用' : '停用'} · 本月 {formatCents(k.monthUsageCents)}</div>
            </div>
            <span className="rt-keys-link">详情</span>
          </div>
        ))}
      </div>

      <div className="rt-actions-row">
        <Button onClick={onAddKey}>+ 新建 Key</Button>
        <Button onClick={onRecharge}>充值</Button>
        {onAdjustBalance && <Button onClick={onAdjustBalance}>手动调余额</Button>}
      </div>
    </div>
  );
}
```

修改 `apps/admin/src/pages/UserDetail/ProductAccountCard.tsx` 调度逻辑:
```tsx
import { CodingPlanCard } from './CodingPlanCard';
import { SubscriptionCard } from './SubscriptionCard';
import { PayAsYouGoCard } from './PayAsYouGoCard';

interface Subscription {
  productId: string;
  productName: string;
  billingMode: 'SUBSCRIPTION' | 'CODING_PLAN' | 'PAY_AS_YOU_GO';
  plan: { id: string; name: string };
  status: string;
  // 各 mode 特有字段(实际数据待 API 返回扩展)
  quotas?: Array<{ windowType: 'ROLLING' | 'FIXED_PERIOD' | 'CUMULATIVE'; durationLabel: string; used: number; limit: number; metric: 'requests' | 'tokens' | 'credits' }>;
  keys?: Array<{ id: string; prefix: string; lastUsedAt?: string; isActive: boolean; monthUsageCents?: number }>;
  planCredits?: { used: number; total: number };
  boosterCredits?: number;
  balanceCents?: number;
  monthUsageCents?: number;
  resetAt?: string;
  remainingDays?: number;
}

interface Props {
  subscription: Subscription;
  userId: string;
}

export function ProductAccountCard({ subscription, userId }: Props) {
  const noop = () => {};
  const { billingMode, productName } = subscription;

  if (billingMode === 'CODING_PLAN') {
    return (
      <CodingPlanCard
        productName={productName}
        resetAt={subscription.resetAt}
        quotas={subscription.quotas ?? []}
        keys={(subscription.keys ?? []).map((k) => ({ id: k.id, prefix: k.prefix, lastUsedAt: k.lastUsedAt, isActive: k.isActive }))}
        onAddKey={noop}
        onRenew={noop}
        onAddQuota={noop}
      />
    );
  }
  if (billingMode === 'SUBSCRIPTION') {
    return (
      <SubscriptionCard
        productName={productName}
        remainingDays={subscription.remainingDays}
        planCredits={subscription.planCredits ?? { used: 0, total: 0 }}
        boosterCredits={subscription.boosterCredits ?? 0}
        onRenew={noop}
        onBuyBooster={noop}
        onAddCredits={noop}
      />
    );
  }
  return (
    <PayAsYouGoCard
      productName={productName}
      balanceCents={subscription.balanceCents ?? 0}
      monthUsageCents={subscription.monthUsageCents ?? 0}
      keys={(subscription.keys ?? []).map((k) => ({
        id: k.id, prefix: k.prefix, lastUsedAt: k.lastUsedAt, isActive: k.isActive,
        monthUsageCents: k.monthUsageCents ?? 0,
      }))}
      onAddKey={noop}
      onRecharge={noop}
      onAdjustBalance={noop}
    />
  );
}
```

- [ ] **Step 4: 跑测试**

Run: `cd apps/admin && pnpm test src/pages/UserDetail/`
Expected: PASS

- [ ] **Step 5: dev 验证**

http://localhost:5174/users/:id 进入详情,如果后端 API 暂未返回 quotas/keys 等扩展字段,卡片显示空但不报错。

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/pages/UserDetail/
git commit -m "feat(admin): UserDetail 3 product card variants (CodingPlan/Subscription/PayAsYouGo)"
```

---

### Task 18: Channels 列表重做 (健康度 dot)

**Files:**
- Modify: `apps/admin/src/pages/Channels/index.tsx`

- [ ] **Step 1: 重写 Channels 主体 (保留原有 form 模态框逻辑,只换列表/PageHeader/StatCardGroup/FilterBar)**

阅读 `apps/admin/src/pages/Channels/index.tsx` 的现有 form/modal 代码段,只重写顶部的:
- 标题区 → PageHeader
- 统计 (`<Statistic>`) → StatCardGroup
- 筛选 → FilterBar
- 表格 → DataTable + 健康度自定义渲染

具体改动:
1. 顶部 import 加 `import { PageHeader, StatCard, StatCardGroup, FilterBar, DataTable, Tag } from '../../components/common';`
2. 删除原 `<Row gutter>` Statistic 块,换成 StatCardGroup
3. 删除原顶部 `<Card>` 包装的搜索 Form,换成 FilterBar
4. 表格 `<Table>` → `<DataTable>`,新增 "健康度" 列:

```tsx
{
  title: '健康度', key: 'health', dataIndex: 'status',
  render: (_: unknown, r: ChannelRecord) => {
    if (!r.isActive) return <span className="rt-health"><span className="rt-health-dot rt-health-dot-muted" />未启用</span>;
    if (r.status === 'healthy' || r.status === 'active') return <span className="rt-health"><span className="rt-health-dot rt-health-dot-ok" />健康</span>;
    if (r.status === 'degraded') return <span className="rt-health"><span className="rt-health-dot rt-health-dot-warn" />波动</span>;
    if (r.status === 'down') return <span className="rt-health"><span className="rt-health-dot rt-health-dot-err" />异常</span>;
    return <span className="rt-health"><span className="rt-health-dot rt-health-dot-muted" />未知</span>;
  },
},
```

加 inline style 块或新建 Channels.css:
```css
.rt-health { display: inline-flex; align-items: center; gap: 6px; }
.rt-health-dot { width: 6px; height: 6px; border-radius: var(--radius-pill); }
.rt-health-dot-ok { background: var(--success); }
.rt-health-dot-warn { background: var(--warning); }
.rt-health-dot-err { background: var(--error); }
.rt-health-dot-muted { background: var(--text-muted); }
```

完整改动量较大,请打开当前文件参考改动方向 (保留所有 Modal、Form、API 调用,只替换布局壳)。

- [ ] **Step 2: 跑 dev 验证**

http://localhost:5174/channels —— 验证:
- 4 卡 (总渠道/健康/异常/今日请求)
- 健康度列用 dot
- FilterBar 横向单行

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/pages/Channels/
git commit -m "feat(admin): redesign Channels with health dots and common components"
```

---

### Task 19: Orders 列表重做 + DetailDrawer

**Files:**
- Modify: `apps/admin/src/pages/Orders/index.tsx`

- [ ] **Step 1: 重写 Orders 主壳**

参考 `apps/admin/src/pages/Orders/index.tsx` 现状,核心改动:
1. 顶部用 `PageHeader` (标题"订单管理" + actions [导出, 异常订单])
2. StatCardGroup 5 卡:今日订单 / 今日 GMV / 支付成功率 / 待退款 / 异常 (现有 dashboardApi 已有 paidOrderCount/totalRevenueCents,其他指标作为 TODO 占位 — 用现有数据估算或 mock)
3. FilterBar 替换原 Form
4. 表格 + DetailDrawer:
   - 选中行调 `setSelectedOrder(record)`
   - DetailDrawer `open={!!selectedOrder}` `onClose={() => setSelectedOrder(null)}`
   - tabs: 基本信息 / 操作记录 / 支付详情
   - 基本信息 Tab 内含时间线 (从 `record.auditLogs` 渲染,每条 dot,颜色按事件类型映射)

时间线渲染示例:
```tsx
function OrderTimeline({ logs }: { logs: AuditLogItem[] }) {
  const dotColor = (toStatus: string) => {
    if (toStatus === 'PAID' || toStatus === 'COMPLETED') return 'var(--success)';
    if (toStatus === 'FAILED' || toStatus === 'REFUND_FAILED') return 'var(--error)';
    if (toStatus === 'REFUNDING' || toStatus === 'FULFILLING') return 'var(--warning)';
    return 'var(--primary)';
  };
  return (
    <div className="rt-timeline">
      {logs.map((l) => (
        <div className="rt-timeline-item" key={l.id}>
          <span className="rt-timeline-dot" style={{ background: dotColor(l.toStatus) }} />
          <div className="rt-timeline-content">
            <div className="rt-timeline-action">{l.fromStatus} → {l.toStatus}</div>
            <div className="rt-timeline-meta">{new Date(l.createdAt).toLocaleString('zh-CN')} · {l.operator}</div>
            {l.detail && <div className="rt-timeline-detail">{l.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
```

加 CSS:
```css
.rt-timeline { margin-top: 8px; }
.rt-timeline-item { display: flex; gap: 10px; padding: 6px 0; }
.rt-timeline-dot { width: 6px; height: 6px; border-radius: var(--radius-pill); margin-top: 6px; flex-shrink: 0; }
.rt-timeline-action { font-size: var(--fs-sm); color: var(--text); }
.rt-timeline-meta { font-size: var(--fs-xs); color: var(--text-muted); margin-top: 2px; }
.rt-timeline-detail { font-size: var(--fs-xs); color: var(--text-secondary); margin-top: 2px; }
```

- [ ] **Step 2: 跑 dev 验证**

http://localhost:5174/orders —— 点一行打开右侧 Drawer,看时间线渲染。

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/pages/Orders/
git commit -m "feat(admin): redesign Orders with DetailDrawer + audit timeline"
```

---

### Task 20: E2E 测试 — 5 样板页面冒烟

**Files:**
- Create: `apps/admin/e2e/admin-redesign.spec.ts` (可能已存在 `e2e/` 目录,放进去)

- [ ] **Step 1: 检查现有 playwright 配置**

```bash
cat /Users/shineli/ruidong/codesphere-admin-saas/playwright.config.ts
ls /Users/shineli/ruidong/codesphere-admin-saas/e2e/
```

- [ ] **Step 2: 写 E2E 冒烟**

写到 `apps/admin/e2e/admin-redesign.spec.ts` (如果根目录 `e2e/` 是用户端的,放 admin/e2e):
```ts
import { test, expect } from '@playwright/test';

const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:5174';

test.describe('Admin redesign smoke', () => {
  test.beforeEach(async ({ page }) => {
    // TODO: 接入实际登录流程 (现有 e2e 应该有,复用)
    await page.goto(`${ADMIN_URL}/login`);
    // 这里假设有一个 dev 登录辅助
  });

  test('Sidebar groups render with all 7 groups', async ({ page }) => {
    await page.goto(ADMIN_URL);
    for (const label of ['总览', '用户运营', '产品中心', '财务中心', '模型与渠道', '监控审计', '系统']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test('Product switcher opens and persists', async ({ page }) => {
    await page.goto(ADMIN_URL);
    await page.getByText(/产品: 全部产品/).click();
    // 选第一个真实产品 (假设 mock)
    await page.getByText(/CodingPlan/).first().click();
    await expect(page.getByText(/产品: CodingPlan/)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/产品: CodingPlan/)).toBeVisible();
  });

  test('Users list shows StatCardGroup + FilterBar + DataTable', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/users`);
    await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible();
    await expect(page.getByPlaceholder(/搜索邮箱/)).toBeVisible();
  });

  test('Orders Drawer opens on row click', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/orders`);
    const firstRow = page.locator('.rt-table .ant-table-row').first();
    await firstRow.click();
    await expect(page.locator('.rt-drawer-title')).toBeVisible();
  });

  test('Legacy routes redirect', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/transactions`);
    await expect(page).toHaveURL(`${ADMIN_URL}/usage`);
  });
});
```

- [ ] **Step 3: 跑 E2E**

```bash
cd /Users/shineli/ruidong/codesphere-admin-saas
pnpm exec playwright test apps/admin/e2e/admin-redesign.spec.ts --reporter=list
```
Expected: PASS (在前置 dev server 启动情况下)

- [ ] **Step 4: Commit**

```bash
git add apps/admin/e2e/admin-redesign.spec.ts
git commit -m "test(admin): add E2E smoke for redesign (sidebar / product switcher / drawer / redirects)"
```

---

### Task 21: 视觉回归基线 (5 样板页 + AdminLayout)

**Files:**
- Create: `apps/admin/e2e/visual.spec.ts`

- [ ] **Step 1: 写视觉回归**

写到 `apps/admin/e2e/visual.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:5174';

test.describe('Visual baselines', () => {
  test('AdminLayout shell', async ({ page }) => {
    await page.goto(ADMIN_URL);
    await expect(page).toHaveScreenshot('shell.png', { fullPage: false });
  });
  test('Dashboard', async ({ page }) => {
    await page.goto(ADMIN_URL);
    await expect(page).toHaveScreenshot('dashboard.png');
  });
  test('Users', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/users`);
    await expect(page).toHaveScreenshot('users.png');
  });
  test('Channels', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/channels`);
    await expect(page).toHaveScreenshot('channels.png');
  });
  test('Orders', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/orders`);
    await expect(page).toHaveScreenshot('orders.png');
  });
});
```

- [ ] **Step 2: 生成基线截图**

```bash
pnpm exec playwright test apps/admin/e2e/visual.spec.ts --update-snapshots
```

- [ ] **Step 3: 验证回归**

```bash
pnpm exec playwright test apps/admin/e2e/visual.spec.ts
```
Expected: PASS,所有截图与基线一致

- [ ] **Step 4: Commit**

```bash
git add apps/admin/e2e/visual.spec.ts apps/admin/e2e/visual.spec.ts-snapshots/
git commit -m "test(admin): add visual regression baselines for 5 sample pages"
```

---

### Task 22: 覆盖率验证

- [ ] **Step 1: 跑覆盖率**

```bash
cd apps/admin && pnpm test:coverage
```

- [ ] **Step 2: 检查门槛**

确认输出:
- 共用组件 (`src/components/common/**`): lines/functions ≥ 95%
- contexts/hooks: lines/functions ≥ 90%
- 整体: lines/functions ≥ 85%

如果未达,在该文件补单元测试 (覆盖未测分支)。

- [ ] **Step 3: Commit (如有补测)**

```bash
git add apps/admin/src/components/common/__tests__/ apps/admin/src/hooks/__tests__/
git commit -m "test(admin): bring coverage to ≥85% threshold"
```

---

## Phase 3: 财务数据补齐 (优先级 1-3)

### Task 23: Dashboard / Orders 补支付成功率与异常订单

**Files:**
- Modify: `apps/admin/src/pages/Dashboard/index.tsx`
- Modify: `apps/admin/src/pages/Orders/index.tsx`
- Modify: `apps/admin/src/api/admin.ts` (如需新接口)

- [ ] **Step 1: 检查后端是否提供聚合接口**

```bash
grep -r "paymentSuccessRate\|abnormalOrders" /Users/shineli/ruidong/codesphere-admin-saas/apps/api/src/
```

如果没有,前端**用现有 orders.list 客户端聚合**:
```ts
// 在 Dashboard fetch 时:
const ordersToday = await ordersApi.list({ startAt: todayStart });
const total = ordersToday.items.length;
const paid = ordersToday.items.filter((o) => o.status === 'PAID' || o.status === 'COMPLETED').length;
const successRate = total ? (paid / total * 100).toFixed(1) : '—';
const abnormal = ordersToday.items.filter((o) => ['FAILED', 'REFUND_FAILED'].includes(o.status)).length;
```

- [ ] **Step 2: 在 Dashboard StatCardGroup 加两个新卡**

替换或追加:
```tsx
<StatCard label="支付成功率" value={`${successRate}%`} />
<StatCard label="异常订单" value={abnormal} variant={abnormal > 0 ? 'error' : 'default'} />
```

- [ ] **Step 3: 在 Orders 顶部加"异常订单"快捷按钮**

`PageHeader` actions 加:
```tsx
<Button onClick={() => setParams((p) => ({ ...p, status: 'FAILED,REFUND_FAILED', page: 1 }))}>异常订单</Button>
```

(注意 `userManageApi.search` 等如不支持多选 status,改为打开筛选 chip 多次)

- [ ] **Step 4: dev 验证**

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/pages/Dashboard/ apps/admin/src/pages/Orders/
git commit -m "feat(admin): add payment success rate + abnormal orders quick filter"
```

---

### Task 24: UserDetail 补 LTV (累计消费 / 退款 / 净收入)

**Files:**
- Modify: `apps/admin/src/pages/UserDetail/index.tsx`

- [ ] **Step 1: 调用 ordersApi.list({userId}) 聚合**

在 `UserDetailPage` useEffect 内加:
```ts
const orders = await ordersApi.list({ userId: id, pageSize: 1000 });
const ltv = orders.items.reduce((acc, o) => {
  if (['PAID', 'COMPLETED', 'FULFILLING'].includes(o.status)) acc.spent += o.amountCents;
  if (o.refundedAt) acc.refunded += (o.refundAmountCents ?? o.amountCents);
  return acc;
}, { spent: 0, refunded: 0 });
const netCents = ltv.spent - ltv.refunded;
```

- [ ] **Step 2: 在 PageHeader 下方加一个 StatCardGroup**

```tsx
<StatCardGroup columns={3}>
  <StatCard label="累计消费" value={`¥${(ltv.spent / 100).toFixed(2)}`} />
  <StatCard label="累计退款" value={`¥${(ltv.refunded / 100).toFixed(2)}`} variant="warning" />
  <StatCard label="净收入" value={`¥${(netCents / 100).toFixed(2)}`} />
</StatCardGroup>
```

- [ ] **Step 3: dev 验证**

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/pages/UserDetail/
git commit -m "feat(admin): add LTV stats (spent/refunded/net) on UserDetail"
```

---

### Task 25: Revenue 按 billingMode 拆分

**Files:**
- Modify: `apps/admin/src/pages/Revenue/index.tsx`

- [ ] **Step 1: 阅读现状**

```bash
cat /Users/shineli/ruidong/codesphere-admin-saas/apps/admin/src/pages/Revenue/index.tsx
```

- [ ] **Step 2: 替换为 PageHeader + 三个 panel**

把 Revenue 页面改成:
```tsx
import { PageHeader, StatCardGroup, StatCard } from '../../components/common';

// 调用 ordersApi.list 拉近 30 天订单,按 product.billingMode 聚合 (前端 join 产品列表,或后端加聚合接口 — 标 TODO)

return (
  <div>
    <PageHeader title="收入分析" subtitle="按计费模式 + 按产品拆分 · 近 30 天" />
    <StatCardGroup columns={3}>
      <StatCard label="订阅收入" value={`¥${subscriptionRevenue}`} />
      <StatCard label="CodingPlan 收入" value={`¥${codingPlanRevenue}`} />
      <StatCard label="按量收入" value={`¥${payAsYouGoRevenue}`} />
    </StatCardGroup>
    {/* 后续: 趋势图 / 占比饼图 - 标 TODO */}
  </div>
);
```

如果后端无"近 30 天订单 + 产品 billingMode" 关联接口,本 Task 写一个**最小可见版本** + TODO 标注待后端聚合接口接入。

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/pages/Revenue/
git commit -m "feat(admin): redesign Revenue with billingMode breakdown (placeholder)"
```

---

## Phase 4: 全量回归 + 文档

### Task 26: 全量回归

- [ ] **Step 1: 跑全量单元测试**

```bash
cd apps/admin && pnpm test
```
Expected: 全部 PASS

- [ ] **Step 2: 跑 typecheck**

```bash
cd apps/admin && pnpm exec tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: 跑 ESLint**

```bash
cd apps/admin && pnpm exec eslint src
```
Expected: 0 errors (warnings OK)

- [ ] **Step 4: 跑 build**

```bash
cd apps/admin && pnpm build
```
Expected: SUCCESS,产物在 `apps/admin/dist/`

- [ ] **Step 5: 跑 E2E**

```bash
cd /Users/shineli/ruidong/codesphere-admin-saas && pnpm exec playwright test apps/admin/e2e/
```
Expected: 全部 PASS

- [ ] **Step 6: 手动 dev 巡检 21 个路由**

```bash
cd apps/admin && pnpm dev
```

逐一打开:
- `/`, `/users`, `/users/:id`, `/products`, `/plans`, `/api-keys`,
- `/orders`, `/usage`, `/revenue`, `/payment-config`,
- `/channels`, `/model-pricing`,
- `/monitoring`, `/audit-logs`, `/announcements`,
- `/team`, `/feature-flags`, `/system-prompts`, `/system-config`

确认无白屏、无 console error。

旧路径重定向也测一遍:
- `/transactions` → `/usage`
- `/sessions` → `/monitoring`
- `/roles` → `/team`
- `/members` → `/team`
- `/booster-packs`, `/campaigns`, `/discount-codes`, `/model-access` → `/plans`

- [ ] **Step 7: Commit (如有修复)**

```bash
git add -p
git commit -m "chore(admin): regression fixes from full sweep"
```

---

### Task 27: 更新 CHANGELOG + README

**Files:**
- Modify: `apps/admin/package.json` (如版本号需 bump)
- Modify: `CHANGELOG.md`
- Modify: `README.md` (如有 admin 章节)
- Create: `apps/admin/MIGRATION.md` (老页面 → 新页面映射,供其他开发者迁移其他页面用)

- [ ] **Step 1: 写 MIGRATION.md**

写到 `apps/admin/MIGRATION.md`:
```markdown
# Admin 端重设计迁移指南

## 路由变更

| 旧路径 | 新路径 | 说明 |
|---|---|---|
| /transactions | /usage | 合并 |
| /sessions | /monitoring | 合并 |
| /roles, /members | /team | 合并 |
| /plan-templates | /plans | 重命名 |
| /booster-packs, /campaigns, /discount-codes | /plans (Tab) | 合并 |
| /model-access | /plans (按套餐配置) | 删除 |

## 权限点变更

见 `src/hooks/useLegacyPermission.ts` 的 `LEGACY_PERMISSION_MAP`。
后端权限 key 不变,前端做映射。

## 共用组件

新增 `src/components/common/`:
- PageHeader — 标题 + 面包屑 + 操作
- StatCard / StatCardGroup — 统计卡
- FilterBar — 横向单行筛选
- DataTable — 统一样式 AntD Table 封装
- DetailDrawer — 右侧滑出详情
- Tag — 受控 variant (success/warn/error/proc/muted)

## 设计 token

`src/styles/theme.ts` (Raytone V1) + `src/styles/tokens.css` CSS 变量。
禁止 inline style 用色,必须走 token。

## 其他页面迁移指引

- 顶部用 PageHeader
- 统计区用 StatCardGroup
- 列表筛选用 FilterBar
- 表格用 DataTable
- 详情用 DetailDrawer 或 PageHeader+breadcrumb 独立路由
- Tag 颜色限定 5 种 variant
```

- [ ] **Step 2: 在 CHANGELOG.md 加条目**

```markdown
## [Unreleased]

### Changed
- admin 端重设计 (apps/admin):
  - 接入 Raytone V1 设计 token,与 codesphere-frontend-saas 视觉对齐
  - 抽 5 个共用组件 (PageHeader / StatCard / FilterBar / DataTable / DetailDrawer)
  - IA 重组: 27 页 → 21 页 (合并 7 处, 新增 ApiKey 管理, 删除模型权限)
  - 权限点按域重命名 (前端映射,后端不动)
  - 5 个样板页面落地: Dashboard / Users / UserDetail / Channels / Orders
  - 顶部产品筛选器 + 7 天 localStorage 持久化
- 详见 docs/superpowers/specs/2026-04-27-admin-redesign-design.md
```

- [ ] **Step 3: Commit**

```bash
git add apps/admin/MIGRATION.md CHANGELOG.md
git commit -m "docs(admin): migration guide + changelog for redesign"
```

---

## Self-Review Notes

执行 Phase 0-4 全部完成后,运行:
```bash
cd apps/admin && pnpm test:coverage && pnpm exec tsc --noEmit && pnpm build && cd ../.. && pnpm exec playwright test apps/admin/e2e/
```

四项全 PASS = 重设计完成。

剩余 16 个未改造页面继续套样板,不在本 plan 范围。
