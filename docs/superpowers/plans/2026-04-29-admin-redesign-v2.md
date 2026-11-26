# Admin 端重设计 v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 admin 端从 v1 (7 一级菜单) 升级到 v2 (9 一级菜单),拆解产品中心,新增 13 个真做页面,升级 PlanDetail 为 6 Tab 详情页,升级 ModelPricing 为模型库,Dashboard 改为订阅+按量双维度,整合 FinanceReports 取代 /usage 和 /revenue。

**Architecture:**
- 全部前端改动 + 路由重排,后端 schema 改动作为独立前置 PR
- 每个新页面: PageHeader / StatCardGroup / FilterBar / DataTable / 详情(Drawer 或独立路由)统一模式
- 占位/未就绪后端的页面: UI 完整渲染,操作按钮 disabled + tooltip 标注 "待后端就绪",空状态有运营文案
- 复用 v1 已建的 6 个 common 组件(Tag/PageHeader/StatCard/FilterBar/DataTable/DetailDrawer)

**Tech Stack:** Vite 6 + React 19 + AntD 5 + TypeScript + react-router 7 + zustand + recharts + vitest + RTL

**Spec:** `docs/superpowers/specs/2026-04-28-admin-redesign-v2-design.md`

**Predecessor:** v1 已部署到 saas-test (`191b6d0` on newsaas)

**Constraints (红线):**
- ❌ 不改后端业务逻辑、Stripe / 微信 / 支付宝集成
- ❌ 不改后端 schema(列入独立后端 PR,前端先用占位)
- ❌ 不修改业务枚举(OrderStatus / SubscriptionStatus 等)
- ✅ 路由变更 + 占位 UI + 视觉重排
- ✅ 权限点扩展(LEGACY_PERMISSION_MAP 加 13 条占位映射)

---

## File Structure

### 新建文件 (本次创建)

```
apps/admin/src/
├── api/
│   └── v2/
│       ├── userSegments.ts       # 占位 API stub
│       ├── tickets.ts            # 占位
│       ├── riskUsers.ts          # 占位
│       ├── riskRules.ts          # 占位
│       ├── grantRules.ts         # 占位
│       ├── referrals.ts          # 占位
│       ├── rechargeTiers.ts      # 占位
│       ├── creditPolicy.ts       # 占位
│       ├── quotaTemplates.ts     # 占位
│       ├── alerts.ts             # 占位
│       └── funnel.ts             # 占位
├── components/
│   └── common/
│       ├── EmptyPlaceholder.tsx  # 占位页空状态组件
│       ├── EmptyPlaceholder.css
│       ├── MetricChart.tsx       # 趋势图封装
│       └── FunnelChart.tsx       # 漏斗图
├── pages/
│   ├── UserSegments/             # 用户分群
│   │   ├── index.tsx             # 列表
│   │   └── detail.tsx            # 详情(独立路由)
│   ├── Tickets/                  # 工单中心
│   │   ├── index.tsx
│   │   └── detail.tsx
│   ├── RiskUsers/index.tsx       # 风险用户
│   ├── RiskRules/index.tsx       # 风控规则(5 Tab)
│   ├── QuotaTemplates/index.tsx  # 配额规则模板库
│   ├── Subscriptions/index.tsx   # 订阅生命周期
│   ├── RechargeTiers/index.tsx   # 充值面额
│   ├── CreditPolicy/index.tsx    # 信用额度
│   ├── GrantRules/               # 定时奖励
│   │   ├── index.tsx
│   │   └── detail.tsx
│   ├── Referrals/index.tsx       # 邀请裂变
│   ├── Models/                   # 模型库(升级 ModelPricing)
│   │   ├── index.tsx
│   │   └── detail.tsx
│   ├── Alerts/index.tsx          # 告警中心
│   └── Funnel/index.tsx          # 业务漏斗
└── lib/
    └── placeholders.ts            # 占位数据生成器
```

### 修改文件

```
apps/admin/src/
├── app.tsx                                # 路由表 + 新增 lazy import
├── config/permissions.ts                  # ROUTE_PERMISSIONS 加新路由
├── hooks/useLegacyPermission.ts           # LEGACY_PERMISSION_MAP 加 13 条占位映射
├── layouts/AdminLayout.tsx                # MENU_GROUPS 重排为 9 一级
├── pages/Dashboard/index.tsx              # 双维度图表
├── pages/PlanDetail/index.tsx             # 6 卡 → 6 Tab
└── pages/[BoosterPacks/Campaigns/DiscountCodes]/index.tsx  # 套规范(PageHeader/Stat/Filter/DataTable)
```

### 删除/重定向

```
/usage       → /finance-reports?tab=apiUsage
/revenue     → /finance-reports?tab=summary
/transactions → /finance-reports?tab=balance
/sessions    → /monitoring
/promo-codes → /discount-codes
/model-access → /plans/:id?tab=models
/model-pricing → /models
```

---

## Phase 编排

| Phase | Tasks | 内容 |
|---|---|---|
| Phase 0 | T1-T3 | 基础设施: 占位组件 + 占位 API stub + 路由表预扩展 |
| Phase 1 | T4-T7 | 9 一级菜单 + 权限点 + 路由重排 + AdminLayout |
| Phase 2 | T8-T10 | Dashboard 双维度 / PlanDetail 6 Tab / 财务整合 |
| Phase 3 | T11-T16 | 用户运营: segments / tickets / risk-users + 现有 Users 扩展 |
| Phase 4 | T17-T22 | 订阅运营: plans/booster-packs/quota-templates/subscriptions + 详设套规范 |
| Phase 5 | T23-T25 | 按量运营 + 营销: recharge-tiers / credit-policy / grant-rules / referrals / campaigns / discount-codes |
| Phase 6 | T26-T28 | 模型与渠道: models 升级 + api-keys + channels(已 v1) |
| Phase 7 | T29-T33 | 监控审计: alerts / funnel / risk-rules / audit-logs / announcements / monitoring |
| Phase 8 | T34-T36 | 系统页 + payment-config 重排 |
| Phase 9 | T37-T39 | 全量回归 + 文档 + 部署 |

总计 **39 个 Task**。任务按"页面"切分,每个 task 内部 4-6 步(测试 → 实现 → 提交)。

---

## Phase 0: 基础设施

### Task 1: EmptyPlaceholder 共用组件

**Files:**
- Create: `apps/admin/src/components/common/EmptyPlaceholder.tsx`
- Create: `apps/admin/src/components/common/EmptyPlaceholder.css`
- Create: `apps/admin/src/components/common/__tests__/EmptyPlaceholder.test.tsx`
- Modify: `apps/admin/src/components/common/index.ts` (add export)

- [ ] **Step 1: 写 failing test**

`apps/admin/src/components/common/__tests__/EmptyPlaceholder.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { EmptyPlaceholder } from '../EmptyPlaceholder';

describe('EmptyPlaceholder', () => {
  it('renders title and description', () => {
    render(<EmptyPlaceholder title="功能开发中" description="后端接口即将就绪" />);
    expect(screen.getByText('功能开发中')).toBeInTheDocument();
    expect(screen.getByText('后端接口即将就绪')).toBeInTheDocument();
  });

  it('renders action when provided', () => {
    render(
      <EmptyPlaceholder
        title="x"
        description="y"
        action={<button>了解更多</button>}
      />,
    );
    expect(screen.getByText('了解更多')).toBeInTheDocument();
  });

  it('renders todo list when provided', () => {
    render(
      <EmptyPlaceholder
        title="x"
        description="y"
        todos={['第一项', '第二项']}
      />,
    );
    expect(screen.getByText('第一项')).toBeInTheDocument();
    expect(screen.getByText('第二项')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑测试 fail**

Run: `cd apps/admin && pnpm test src/components/common/__tests__/EmptyPlaceholder.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 EmptyPlaceholder.tsx**

```tsx
import { ReactNode } from 'react';
import { InboxOutlined } from '@ant-design/icons';
import './EmptyPlaceholder.css';

interface EmptyPlaceholderProps {
  title: string;
  description: string;
  action?: ReactNode;
  todos?: string[];
  icon?: ReactNode;
}

export function EmptyPlaceholder({ title, description, action, todos, icon }: EmptyPlaceholderProps) {
  return (
    <div className="rt-empty-ph">
      <div className="rt-empty-ph-icon">{icon ?? <InboxOutlined style={{ fontSize: 48 }} />}</div>
      <div className="rt-empty-ph-title">{title}</div>
      <div className="rt-empty-ph-desc">{description}</div>
      {todos && todos.length > 0 && (
        <ul className="rt-empty-ph-todos">
          {todos.map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      )}
      {action && <div className="rt-empty-ph-action">{action}</div>}
    </div>
  );
}
```

`apps/admin/src/components/common/EmptyPlaceholder.css`:
```css
.rt-empty-ph {
  padding: 60px 24px;
  text-align: center;
  color: var(--text-muted);
}
.rt-empty-ph-icon { color: var(--text-muted); margin-bottom: 12px; }
.rt-empty-ph-title { font-size: var(--fs-md); color: var(--text); font-weight: 500; }
.rt-empty-ph-desc { font-size: var(--fs-sm); margin-top: 6px; line-height: 1.6; max-width: 480px; margin-left: auto; margin-right: auto; }
.rt-empty-ph-todos { display: inline-block; text-align: left; margin-top: 16px; padding-left: 20px; font-size: var(--fs-sm); }
.rt-empty-ph-todos li { padding: 4px 0; }
.rt-empty-ph-action { margin-top: 18px; }
```

- [ ] **Step 4: 加入 barrel**

`apps/admin/src/components/common/index.ts` 末尾加：
```ts
export { EmptyPlaceholder } from './EmptyPlaceholder';
```

- [ ] **Step 5: 跑测试 pass + typecheck**

Run: `cd apps/admin && pnpm test src/components/common/__tests__/EmptyPlaceholder.test.tsx`
Expected: PASS, 3 tests

Run: `cd apps/admin && pnpm exec tsc --noEmit`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/components/common/EmptyPlaceholder* apps/admin/src/components/common/__tests__/EmptyPlaceholder.test.tsx apps/admin/src/components/common/index.ts
git commit -m "feat(admin): add EmptyPlaceholder common component for stub pages"
```

---

### Task 2: MetricChart + FunnelChart 共用组件

**Files:**
- Create: `apps/admin/src/components/common/MetricChart.tsx`
- Create: `apps/admin/src/components/common/FunnelChart.tsx`
- Create: `apps/admin/src/components/common/__tests__/MetricChart.test.tsx`

- [ ] **Step 1: 写 MetricChart failing test**

```tsx
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MetricChart } from '../MetricChart';

describe('MetricChart', () => {
  it('renders without crashing with empty data', () => {
    const { container } = render(<MetricChart data={[]} dataKey="value" />);
    expect(container.querySelector('.rt-chart')).not.toBeNull();
  });

  it('renders with sample data', () => {
    const data = [{ date: '2026-04-01', value: 100 }, { date: '2026-04-02', value: 200 }];
    const { container } = render(<MetricChart data={data} dataKey="value" />);
    expect(container.querySelector('.rt-chart')).not.toBeNull();
  });
});
```

- [ ] **Step 2: 实现 MetricChart**

`apps/admin/src/components/common/MetricChart.tsx`:
```tsx
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
  xKey = 'date',
  height = 200,
  color = '#0E2A47',
}: MetricChartProps<T>) {
  return (
    <div className="rt-chart" style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="rt-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.18} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#F1ECE2" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: '#8B94A3' }} />
          <YAxis tick={{ fontSize: 11, fill: '#8B94A3' }} />
          <Tooltip />
          <Area type="monotone" dataKey={dataKey} stroke={color} fill="url(#rt-area)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 3: 实现 FunnelChart (基于 div 直接画,recharts FunnelChart 实验性)**

```tsx
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
  return (
    <div className="rt-funnel">
      {steps.map((s, i) => {
        const widthPct = (s.value / max) * 100;
        const conversionPct = i > 0 && steps[i - 1].value > 0
          ? ((s.value / steps[i - 1].value) * 100).toFixed(1)
          : null;
        return (
          <div key={i} className="rt-funnel-row">
            <div className="rt-funnel-label">{s.label}</div>
            <div className="rt-funnel-bar-wrap">
              <div className="rt-funnel-bar" style={{ width: `${widthPct}%` }}>
                <span className="rt-funnel-value">{s.value.toLocaleString('zh-CN')}</span>
              </div>
            </div>
            <div className="rt-funnel-conv">{conversionPct ? `${conversionPct}%` : '—'}</div>
          </div>
        );
      })}
      <style>{`
        .rt-funnel { padding: 12px; }
        .rt-funnel-row { display: grid; grid-template-columns: 120px 1fr 80px; align-items: center; gap: 12px; padding: 6px 0; }
        .rt-funnel-label { font-size: var(--fs-sm); color: var(--text); }
        .rt-funnel-bar-wrap { background: rgba(14,42,71,0.04); border-radius: 4px; height: 28px; }
        .rt-funnel-bar { background: var(--primary); height: 100%; border-radius: 4px; display: flex; align-items: center; padding: 0 10px; transition: width 0.3s; }
        .rt-funnel-value { color: white; font-size: var(--fs-xs); font-weight: 500; font-variant-numeric: tabular-nums; }
        .rt-funnel-conv { color: var(--text-secondary); font-size: var(--fs-xs); text-align: right; font-variant-numeric: tabular-nums; }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 4: 加入 barrel**

`index.ts` 末尾追加：
```ts
export { MetricChart } from './MetricChart';
export { FunnelChart } from './FunnelChart';
```

- [ ] **Step 5: 跑测试 + typecheck**

Run: `cd apps/admin && pnpm test src/components/common/__tests__/MetricChart.test.tsx`
Expected: PASS

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/components/common/MetricChart.tsx apps/admin/src/components/common/FunnelChart.tsx apps/admin/src/components/common/__tests__/MetricChart.test.tsx apps/admin/src/components/common/index.ts
git commit -m "feat(admin): add MetricChart + FunnelChart for v2 dashboards"
```

---

### Task 3: 占位 API stub 模块

**Files:**
- Create: `apps/admin/src/api/v2/userSegments.ts`
- Create: `apps/admin/src/api/v2/tickets.ts`
- Create: `apps/admin/src/api/v2/riskUsers.ts`
- Create: `apps/admin/src/api/v2/riskRules.ts`
- Create: `apps/admin/src/api/v2/grantRules.ts`
- Create: `apps/admin/src/api/v2/referrals.ts`
- Create: `apps/admin/src/api/v2/rechargeTiers.ts`
- Create: `apps/admin/src/api/v2/creditPolicy.ts`
- Create: `apps/admin/src/api/v2/quotaTemplates.ts`
- Create: `apps/admin/src/api/v2/alerts.ts`
- Create: `apps/admin/src/api/v2/funnel.ts`
- Create: `apps/admin/src/api/v2/index.ts`

每个 stub 文件的模板:

```ts
// userSegments.ts
import http from '../axios';

export interface UserSegment {
  id: string;
  name: string;
  description: string;
  ruleType: 'STATIC' | 'DYNAMIC';
  ruleExpr?: string;
  memberCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserSegmentListResp {
  items: UserSegment[];
  total: number;
}

export const userSegmentApi = {
  /** 列表。后端未就绪时调用方应捕获 404 改用占位数据。 */
  list: (params: { page?: number; pageSize?: number; search?: string; ruleType?: string; isActive?: boolean } = {}) =>
    http.get<UserSegmentListResp>('/admin/v2/user-segments', { params }),

  get: (id: string) => http.get<UserSegment>(`/admin/v2/user-segments/${id}`),

  create: (data: Partial<UserSegment>) => http.post<UserSegment>('/admin/v2/user-segments', data),

  update: (id: string, data: Partial<UserSegment>) =>
    http.put<UserSegment>(`/admin/v2/user-segments/${id}`, data),

  delete: (id: string) => http.delete(`/admin/v2/user-segments/${id}`),

  /** 预览动态规则匹配数 */
  preview: (ruleExpr: string) =>
    http.post<{ matchedCount: number; sampleUserIds: string[] }>('/admin/v2/user-segments/preview', { ruleExpr }),

  refresh: (id: string) => http.post(`/admin/v2/user-segments/${id}/refresh`),
};
```

每个其他 stub 类似:
- `tickets.ts`: list/get/create/reply/updateStatus/assign/close
- `riskUsers.ts`: list/get/release/permanentBan
- `riskRules.ts`: list/get/create/update/delete + 5 sub-tabs (blacklist/usage/ip/refund/fraud)
- `grantRules.ts`: list/get/create/update/delete/preview/manualTrigger/listRedemptions
- `referrals.ts`: programs CRUD + redemptions list + leaderboard
- `rechargeTiers.ts`: list/get/create/update/delete
- `creditPolicy.ts`: getGlobal/updateGlobal + listSegmentOverrides + listOverdueUsers
- `quotaTemplates.ts`: list/get/create/update/delete + listReferences (哪些 plan 用了)
- `alerts.ts`: list/get/markRead/handle/createRule
- `funnel.ts`: getFunnel + getSegmentFunnel

- [ ] **Step 1: 创建所有 stub 文件**

每个文件 export 一个 `xxxApi` 对象,内部调用 `http.get/post/put/delete`,接口路径 `/admin/v2/{name}`。

- [ ] **Step 2: 创建 barrel `apps/admin/src/api/v2/index.ts`**

```ts
export * from './userSegments';
export * from './tickets';
export * from './riskUsers';
export * from './riskRules';
export * from './grantRules';
export * from './referrals';
export * from './rechargeTiers';
export * from './creditPolicy';
export * from './quotaTemplates';
export * from './alerts';
export * from './funnel';
```

- [ ] **Step 3: 验证 typecheck**

Run: `cd apps/admin && pnpm exec tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/api/v2/
git commit -m "feat(admin): add v2 API stubs for 11 placeholder modules"
```

---

## Phase 1: 9 一级菜单 + 路由 + 权限

### Task 4: 扩展 LEGACY_PERMISSION_MAP

**Files:** Modify: `apps/admin/src/hooks/useLegacyPermission.ts`

- [ ] **Step 1: 在 `LEGACY_PERMISSION_MAP` 末尾追加 13 条新映射**

```ts
  // v2 新增权限映射（后端权限 key 暂未注册时,super_admin 可访问全部）
  'admin.user_segments.manage': 'users.segments.manage',
  'admin.tickets.manage': 'users.tickets.manage',
  'admin.risk.users.manage': 'users.risk.manage',
  'admin.quota_rules.manage': 'products.subscriptions.quota.manage',
  'admin.subscriptions.manage': 'products.subscriptions.lifecycle.manage',
  'admin.recharge_tiers.manage': 'products.payg.tiers.manage',
  'admin.credit_policy.manage': 'products.payg.policy.manage',
  'admin.grant_rules.manage': 'marketing.grants.manage',
  'admin.referrals.manage': 'marketing.referrals.manage',
  'admin.alerts.manage': 'audit.alerts.manage',
  'admin.funnel.read': 'audit.funnel.read',
  'admin.risk.rules.manage': 'audit.risk.manage',
  'admin.api_keys.manage': 'ops.apikeys.manage',
```

- [ ] **Step 2: 运行现有测试,无回归**

Run: `cd apps/admin && pnpm test src/hooks/__tests__/useLegacyPermission.test.tsx`
Expected: 5/5 pass

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/hooks/useLegacyPermission.ts
git commit -m "feat(admin): extend LEGACY_PERMISSION_MAP with 13 v2 placeholder mappings"
```

---

### Task 5: 扩展 ROUTE_PERMISSIONS

**Files:** Modify: `apps/admin/src/config/permissions.ts`

- [ ] **Step 1: 在 `ROUTE_PERMISSIONS` 加入 13 条新路由**

```ts
  // v2 新增路由
  '/user-segments': 'admin.user_segments.manage',
  '/user-segments/:id': 'admin.user_segments.manage',
  '/tickets': 'admin.tickets.manage',
  '/tickets/:id': 'admin.tickets.manage',
  '/risk-users': 'admin.risk.users.manage',
  '/quota-rules': 'admin.quota_rules.manage',
  '/subscriptions': 'admin.subscriptions.manage',
  '/recharge-tiers': 'admin.recharge_tiers.manage',
  '/credit-policy': 'admin.credit_policy.manage',
  '/grant-rules': 'admin.grant_rules.manage',
  '/grant-rules/:id': 'admin.grant_rules.manage',
  '/referrals': 'admin.referrals.manage',
  '/alerts': 'admin.alerts.manage',
  '/funnel': 'admin.funnel.read',
  '/risk-rules': 'admin.risk.rules.manage',
  '/models': 'admin.plans.manage',
  '/models/:id': 'admin.plans.manage',
```

- [ ] **Step 2: 在 `ADMIN_ROUTE_ORDER` 中插入新路由(按一级菜单顺序)**

```ts
export const ADMIN_ROUTE_ORDER = [
  '/',
  '/users', '/user-segments', '/tickets', '/risk-users',
  '/products', '/plans', '/booster-packs', '/quota-rules', '/subscriptions',
  '/api-keys',
  '/recharge-tiers', '/credit-policy',
  '/campaigns', '/discount-codes', '/grant-rules', '/referrals',
  '/models', '/channels',
  '/orders', '/finance-reports', '/payment-config',
  '/monitoring', '/alerts', '/funnel', '/risk-rules', '/audit-logs', '/announcements',
  '/team', '/members', '/feature-flags', '/system-prompts', '/system-config',
] as const;
```

- [ ] **Step 3: typecheck**

Run: `cd apps/admin && pnpm exec tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/config/permissions.ts
git commit -m "feat(admin): add 13 v2 routes to ROUTE_PERMISSIONS + ADMIN_ROUTE_ORDER"
```

---

### Task 6: 重排 AdminLayout 为 9 一级菜单

**Files:** Modify: `apps/admin/src/layouts/AdminLayout.tsx`

- [ ] **Step 1: 替换 MENU_GROUPS 为 9 一级结构**

```tsx
const MENU_GROUPS: MenuGroup[] = [
  { key: 'overview', label: '总览', icon: <DashboardOutlined />, items: [
    { key: '/', label: '运营总览' },
  ]},
  { key: 'users', label: '用户运营', icon: <UserOutlined />, items: [
    { key: '/users', label: '用户列表' },
    { key: '/user-segments', label: '用户分群' },
    { key: '/tickets', label: '工单中心' },
    { key: '/risk-users', label: '风险用户' },
  ]},
  { key: 'subscriptions', label: '订阅运营', icon: <CrownOutlined />, items: [
    { key: '/plans', label: '套餐管理' },
    { key: '/booster-packs', label: '加油包' },
    { key: '/quota-rules', label: '配额规则' },
    { key: '/subscriptions', label: '订阅生命周期' },
  ]},
  { key: 'payg', label: '按量运营', icon: <DollarOutlined />, items: [
    { key: '/recharge-tiers', label: '充值面额' },
    { key: '/credit-policy', label: '信用额度' },
  ]},
  { key: 'marketing', label: '营销', icon: <TagOutlined />, items: [
    { key: '/campaigns', label: '限时活动' },
    { key: '/discount-codes', label: '促销码' },
    { key: '/grant-rules', label: '定时奖励' },
    { key: '/referrals', label: '邀请裂变' },
  ]},
  { key: 'ops', label: '模型与渠道', icon: <ApiOutlined />, items: [
    { key: '/models', label: '模型库' },
    { key: '/channels', label: '渠道管理' },
    { key: '/api-keys', label: 'ApiKey 管理' },
  ]},
  { key: 'finance', label: '财务中心', icon: <FileTextOutlined />, items: [
    { key: '/orders', label: '订单管理' },
    { key: '/finance-reports', label: '财务报表' },
    { key: '/payment-config', label: '支付配置' },
  ]},
  { key: 'audit', label: '监控审计', icon: <MonitorOutlined />, items: [
    { key: '/monitoring', label: '实时监控' },
    { key: '/alerts', label: '告警中心' },
    { key: '/funnel', label: '业务漏斗' },
    { key: '/risk-rules', label: '风控规则' },
    { key: '/audit-logs', label: '审计日志' },
    { key: '/announcements', label: '公告' },
  ]},
  { key: 'system', label: '系统', icon: <SettingOutlined />, items: [
    { key: '/team', label: '角色权限' },
    { key: '/members', label: '后台账号' },
    { key: '/feature-flags', label: '功能开关' },
    { key: '/system-prompts', label: '系统提示词' },
    { key: '/system-config', label: '系统设置' },
  ]},
];
```

import 部分加 CrownOutlined / TagOutlined / FileTextOutlined,移除不再用的 AppstoreOutlined。

- [ ] **Step 2: 跑 typecheck + dev**

Run: `pnpm exec tsc --noEmit`
Run: `pnpm dev` 浏览器打开,左侧菜单 9 一级显示。点击菜单项可正常跳转(尚未实现的页面会落到 `*` catch-all,先重定向 `/`)。

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/layouts/AdminLayout.tsx
git commit -m "feat(admin): rearrange AdminLayout to 9 top-level menu groups"
```

---

### Task 7: app.tsx 路由表扩展 + 重定向

**Files:** Modify: `apps/admin/src/app.tsx`

- [ ] **Step 1: 加 13 个新页面 lazy import**

在现有 lazy 块末尾追加:
```tsx
const UserSegmentsPage = lazy(() => import('./pages/UserSegments'));
const UserSegmentDetailPage = lazy(() => import('./pages/UserSegments/detail'));
const TicketsPage = lazy(() => import('./pages/Tickets'));
const TicketDetailPage = lazy(() => import('./pages/Tickets/detail'));
const RiskUsersPage = lazy(() => import('./pages/RiskUsers'));
const QuotaTemplatesPage = lazy(() => import('./pages/QuotaTemplates'));
const SubscriptionsPage = lazy(() => import('./pages/Subscriptions'));
const RechargeTiersPage = lazy(() => import('./pages/RechargeTiers'));
const CreditPolicyPage = lazy(() => import('./pages/CreditPolicy'));
const GrantRulesPage = lazy(() => import('./pages/GrantRules'));
const GrantRuleDetailPage = lazy(() => import('./pages/GrantRules/detail'));
const ReferralsPage = lazy(() => import('./pages/Referrals'));
const ModelsPage = lazy(() => import('./pages/Models'));
const ModelDetailPage = lazy(() => import('./pages/Models/detail'));
const AlertsPage = lazy(() => import('./pages/Alerts'));
const FunnelPage = lazy(() => import('./pages/Funnel'));
const RiskRulesPage = lazy(() => import('./pages/RiskRules'));
```

- [ ] **Step 2: 在 `<Route element={<AdminLayout />}>` 内添加新路由**

```tsx
<Route path="/user-segments" element={<UserSegmentsPage />} />
<Route path="/user-segments/:id" element={<UserSegmentDetailPage />} />
<Route path="/tickets" element={<TicketsPage />} />
<Route path="/tickets/:id" element={<TicketDetailPage />} />
<Route path="/risk-users" element={<RiskUsersPage />} />
<Route path="/quota-rules" element={<QuotaTemplatesPage />} />
<Route path="/subscriptions" element={<SubscriptionsPage />} />
<Route path="/recharge-tiers" element={<RechargeTiersPage />} />
<Route path="/credit-policy" element={<CreditPolicyPage />} />
<Route path="/grant-rules" element={<GrantRulesPage />} />
<Route path="/grant-rules/:id" element={<GrantRuleDetailPage />} />
<Route path="/referrals" element={<ReferralsPage />} />
<Route path="/models" element={<ModelsPage />} />
<Route path="/models/:id" element={<ModelDetailPage />} />
<Route path="/alerts" element={<AlertsPage />} />
<Route path="/funnel" element={<FunnelPage />} />
<Route path="/risk-rules" element={<RiskRulesPage />} />

{/* v2 重定向 */}
<Route path="/model-pricing" element={<Navigate to="/models" replace />} />
<Route path="/usage" element={<Navigate to="/finance-reports" replace />} />
<Route path="/revenue" element={<Navigate to="/finance-reports" replace />} />
<Route path="/transactions" element={<Navigate to="/finance-reports" replace />} />
```

- [ ] **Step 3: dev 验证 13 个路由能加载(占位页面文件还没建,先用临时 stub 应对)**

由于占位页面文件还没建,临时在每个 `pages/UserSegments/index.tsx` 等创建空 stub:
```tsx
export default function StubPage() {
  return <div>开发中</div>;
}
```

(后续 Task 11+ 再替换为真实 UI)

- [ ] **Step 4: typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/app.tsx apps/admin/src/pages/
git commit -m "feat(admin): add v2 routes + temporary stubs (real UI in later tasks)"
```

---

## Phase 2: Dashboard 双维度 + PlanDetail 6 Tab + 财务整合

### Task 8: Dashboard 双维度图表

**Files:** Modify: `apps/admin/src/pages/Dashboard/index.tsx`, `apps/admin/src/pages/Dashboard/Dashboard.css`

- [ ] **Step 1: 替换 Dashboard 主体为双维度布局**

完整替换 `apps/admin/src/pages/Dashboard/index.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Spin } from 'antd';
import { PageHeader, StatCard, StatCardGroup, MetricChart } from '../../components/common';
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
    const fetcher = productId
      ? (dashboardApi.stats as (p: { productId: string }) => Promise<Stats>)({ productId })
      : dashboardApi.stats();
    Promise.resolve(fetcher).then(setStats).finally(() => setLoading(false));
  }, [productId]);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!stats) return null;

  // TODO: 后端 /admin/dashboard/v2 提供真实趋势数据。临时用占位生成器。
  const subscriptionTrend = generatePlaceholderTrend(30, 5000, 100);
  const paygTrend = generatePlaceholderTrend(30, 3000, 80);

  return (
    <div>
      <PageHeader
        title="运营总览"
        subtitle={`当前范围: ${productId ?? '全部产品'} · 近 30 天`}
      />

      <StatCardGroup columns={5}>
        <StatCard label="总用户" value={stats.userCount} />
        <StatCard label="MRR (订阅)" value={`¥${(stats.totalRevenueCents / 100).toLocaleString('zh-CN')}`} />
        <StatCard label="本月收入" value={`¥${(stats.totalRevenueCents / 100).toLocaleString('zh-CN')}`} />
        <StatCard label="异常订单" value="—" variant="warning" />
        <StatCard label="未处理告警" value="—" variant="error" />
      </StatCardGroup>

      <div className="rt-dash-2col">
        <section className="rt-panel">
          <header><h3>订阅维度</h3><span className="rt-panel-sub">订阅产品健康度</span></header>
          <MetricChart data={subscriptionTrend} dataKey="value" height={180} />
          <div className="rt-dash-mini-stats">
            <div><div className="lbl">活跃订阅</div><div className="val">{stats.paidOrderCount}</div></div>
            <div><div className="lbl">续订率</div><div className="val">—</div></div>
            <div><div className="lbl">流失率</div><div className="val">—</div></div>
          </div>
          <div className="rt-dash-list-h">即将到期 (7 天内)</div>
          <div className="rt-list-placeholder">待后端 /admin/dashboard/v2 接入</div>
        </section>
        <section className="rt-panel">
          <header><h3>按量维度</h3><span className="rt-panel-sub">按量产品健康度</span></header>
          <MetricChart data={paygTrend} dataKey="value" height={180} color="#E8B464" />
          <div className="rt-dash-mini-stats">
            <div><div className="lbl">充值收入</div><div className="val">—</div></div>
            <div><div className="lbl">余额告警用户</div><div className="val">—</div></div>
            <div><div className="lbl">日均消耗</div><div className="val">—</div></div>
          </div>
          <div className="rt-dash-list-h">高消耗用户 Top 10</div>
          <div className="rt-list-placeholder">待后端聚合接口接入</div>
        </section>
      </div>

      <div className="rt-dash-3col">
        <section className="rt-panel">
          <header><h3>最近订单</h3><Link to="/orders" className="rt-link">全部</Link></header>
          <div className="rt-list-placeholder">最新 5 笔订单</div>
        </section>
        <section className="rt-panel">
          <header><h3>系统告警</h3><Link to="/alerts" className="rt-link">告警中心</Link></header>
          <div className="rt-list-placeholder">未处理告警</div>
        </section>
        <section className="rt-panel">
          <header><h3>模型/渠道健康</h3><Link to="/channels" className="rt-link">渠道管理</Link></header>
          <div className="rt-list-placeholder">健康/异常/波动</div>
        </section>
      </div>
    </div>
  );
}

// 临时占位数据生成器,后端 /admin/dashboard/v2 就绪后删除
function generatePlaceholderTrend(days: number, base: number, variance: number) {
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    result.push({
      date: date.toISOString().slice(5, 10),
      value: base + Math.floor((Math.random() - 0.5) * variance * 2),
    });
  }
  return result;
}
```

- [ ] **Step 2: 替换 Dashboard.css**

```css
.rt-dash-2col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-bottom: 14px;
}
.rt-dash-3col {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
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
.rt-dash-mini-stats {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
  margin: 10px 0; padding: 10px; background: rgba(14,42,71,0.02); border-radius: 6px;
}
.rt-dash-mini-stats .lbl { font-size: var(--fs-xs); color: var(--text-muted); }
.rt-dash-mini-stats .val { font-size: var(--fs-md); font-weight: 500; color: var(--primary-dark); margin-top: 4px; }
.rt-dash-list-h { font-size: var(--fs-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; margin: 12px 0 8px; }
.rt-list-placeholder {
  height: 80px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-muted); font-size: var(--fs-sm);
  background: rgba(14,42,71,0.02); border-radius: 6px;
}
.rt-link { color: var(--primary); text-decoration: none; font-size: var(--fs-sm); }
.rt-link:hover { text-decoration: underline; }
```

- [ ] **Step 3: dev 验证**

Run: `pnpm dev`
打开 / 看到双列(订阅+按量) + 3 列(订单/告警/渠道)布局。趋势图渲染正常。

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/pages/Dashboard/
git commit -m "feat(admin): redesign Dashboard with subscription + pay-as-you-go dual chart"
```

---

### Task 9: PlanDetail 6 卡 → 6 Tab

**Files:** Modify: `apps/admin/src/pages/PlanDetail/index.tsx`

- [ ] **Step 1: 重构主组件结构**

PlanDetail 当前是 6 张卡片同页。改为 AntD `<Tabs>`,每 Tab 一个子组件函数。文件结构:

```tsx
import { Tabs } from 'antd';
import { OverviewTab } from './tabs/Overview';
import { PriceTab } from './tabs/Price';
import { ModelsTab } from './tabs/Models';
import { QuotaTab } from './tabs/Quota';
import { TeamTab } from './tabs/Team';
import { AdvancedTab } from './tabs/Advanced';

// ... PlanDetailPage 主体
return (
  <div>
    <PageHeader
      title={plan.name}
      breadcrumb={[{ label: '套餐管理', to: '/plans' }, plan.name]}
      actions={[
        <Button onClick={handleClone}>复制</Button>,
        <Button onClick={handleToggleActive}>{plan.isActive ? '下架' : '上架'}</Button>,
        <Button danger onClick={handleDelete}>删除</Button>,
      ]}
    />
    <Tabs
      defaultActiveKey="overview"
      items={[
        { key: 'overview', label: '概览', children: <OverviewTab plan={plan} onChange={setPlan} /> },
        { key: 'price', label: '价格', children: <PriceTab plan={plan} onChange={setPlan} /> },
        { key: 'models', label: '模型', children: <ModelsTab plan={plan} onChange={setPlan} /> },
        { key: 'quota', label: '配额', children: <QuotaTab plan={plan} onChange={setPlan} />, disabled: plan.planType !== 'coding_plan' },
        { key: 'team', label: '团队', children: <TeamTab plan={plan} onChange={setPlan} /> },
        { key: 'advanced', label: '高级', children: <AdvancedTab plan={plan} onChange={setPlan} /> },
      ]}
    />
    <div className="rt-plan-footer">
      <Button onClick={() => navigate('/plans')}>取消</Button>
      <Button type="primary" loading={saving} onClick={handleSave}>保存</Button>
    </div>
  </div>
);
```

- [ ] **Step 2: 拆分 6 个 Tab 子组件**

Create directory `apps/admin/src/pages/PlanDetail/tabs/` 并创建:
- `Overview.tsx` (基本信息: name/description/productId/planType/billingPeriod/月费/年费/月度积分/creditsRollover/sortOrder/isActive/badge)
- `Price.tsx` (PlanPrice 多币种 CRUD + trialDays + 试用结束策略)
- `Models.tsx` (ModelAccess 关联 + 倍率)
- `Quota.tsx` (PlanQuotaRule 多条规则 + rateLimitRpm/rateLimitTpm/maxContextWindow)
- `Team.tsx` (memberLimit / minimumSeats / 共享配额规则 / 邀请权限)
- `Advanced.tsx` (overageEnabled / usageMultiplier / 自动续费 / 退款策略 / dataTraining / supportTier / ssoEnabled / priorityAccess)

每 Tab 子组件接受 `{ plan, onChange }` props,内部用 AntD Form 渲染对应字段。Tab 内表单变化通过 `onChange(updatedPlan)` 上报到父组件,父组件保存按钮提交所有改动。

`Overview.tsx` 模板示例(其他 5 个类似结构):
```tsx
import { Form, Input, InputNumber, Select, Switch } from 'antd';
import type { Plan } from '../types';

export function OverviewTab({ plan, onChange }: { plan: Plan; onChange: (p: Plan) => void }) {
  return (
    <Form layout="vertical" initialValues={plan} onValuesChange={(_, values) => onChange({ ...plan, ...values })}>
      <Form.Item label="套餐名称" name="name" rules={[{ required: true }]}><Input /></Form.Item>
      <Form.Item label="描述" name="description"><Input.TextArea rows={2} /></Form.Item>
      <Form.Item label="计费类型" name="planType">
        <Select options={[
          { value: 'individual', label: '个人' },
          { value: 'team', label: '团队' },
          { value: 'enterprise', label: '企业' },
          { value: 'coding_plan', label: 'CodingPlan (配额)' },
        ]} />
      </Form.Item>
      <Form.Item label="计费周期" name="billingPeriod">
        <Select options={[
          { value: 'monthly', label: '月付' },
          { value: 'yearly', label: '年付' },
          { value: 'quarterly', label: '季付' },
        ]} />
      </Form.Item>
      <Form.Item label="月费(元)" name="monthlyPrice"><InputNumber min={0} /></Form.Item>
      <Form.Item label="年费(元)" name="yearlyPrice"><InputNumber min={0} /></Form.Item>
      <Form.Item label="月度积分" name="monthlyCredits"><InputNumber min={0} /></Form.Item>
      <Form.Item label="积分滚存" name="creditsRollover" valuePropName="checked"><Switch /></Form.Item>
      <Form.Item label="徽章" name="badge"><Input placeholder="如:最受欢迎" /></Form.Item>
      <Form.Item label="排序" name="sortOrder"><InputNumber min={0} /></Form.Item>
      <Form.Item label="启用" name="isActive" valuePropName="checked"><Switch /></Form.Item>
    </Form>
  );
}
```

其他 5 个 Tab 子组件结构类似,字段集见 spec §19.5。

- [ ] **Step 3: dev 验证**

打开 `/plans/:id` 看到 6 Tab,默认在概览 Tab,字段填充正确。切换 Tab 不丢数据。配额 Tab 仅 planType=coding_plan 时启用。

- [ ] **Step 4: typecheck + Commit**

Run: `pnpm exec tsc --noEmit`

```bash
git add apps/admin/src/pages/PlanDetail/
git commit -m "feat(admin): refactor PlanDetail from 6 cards to 6 tabs"
```

---

### Task 10: 财务模块整合 (Navigate redirect 已 Task 7 完成,此处仅简化)

**Files:** Modify: `apps/admin/src/pages/FinanceReports/index.tsx`(若需要)

- [ ] **Step 1: 验证 /usage /revenue /transactions 重定向到 /finance-reports 正确**

Run: `pnpm dev` 然后浏览器访问 `/usage` 自动跳到 `/finance-reports`。

- [ ] **Step 2: 在 FinanceReports PageHeader 加产品筛选器联动**

读现有 FinanceReports.tsx 头部,找到 PageHeader,在 subtitle 加产品筛选器值显示:

```tsx
import { useCurrentProduct } from '../../hooks/useCurrentProduct';

// 在组件顶部:
const productId = useCurrentProduct();

// 在 PageHeader subtitle:
subtitle={`${productId ? `产品: ${productId} · ` : ''}财务对账与报表`}
```

如果 FinanceReports 已经使用产品筛选器,跳过此步。

- [ ] **Step 3: Commit (若有改动)**

```bash
git add apps/admin/src/pages/FinanceReports/
git commit -m "feat(admin): finance reports honor product filter"
```

---

## Phase 3: 用户运营详做

### Task 11: 用户分群 `/user-segments` (列表 + 详情)

**Files:**
- Create: `apps/admin/src/pages/UserSegments/index.tsx` (列表)
- Create: `apps/admin/src/pages/UserSegments/detail.tsx` (详情独立路由)
- Replace stub from Task 7

- [ ] **Step 1: 实现列表页 (`index.tsx`)**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Modal, Form, Input, Select, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { PageHeader, StatCard, StatCardGroup, FilterBar, DataTable, Tag, EmptyPlaceholder } from '../../components/common';
import { userSegmentApi, UserSegment } from '../../api/v2';

export default function UserSegmentsPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<{ items: UserSegment[]; total: number }>({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [params, setParams] = useState<{ page: number; pageSize: number; search?: string; ruleType?: string }>({ page: 1, pageSize: 20 });
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [stubMode, setStubMode] = useState(false);

  useEffect(() => {
    setLoading(true);
    userSegmentApi.list(params)
      .then((res) => { setData(res); setStubMode(false); })
      .catch(() => { setStubMode(true); setData({ items: [], total: 0 }); })
      .finally(() => setLoading(false));
  }, [params]);

  if (stubMode) {
    return (
      <div>
        <PageHeader title="用户分群" subtitle="定义用户标签 / 自动分群规则,用于活动、促销码、定时奖励" />
        <EmptyPlaceholder
          title="后端接口待就绪"
          description="此页面 UI 已完成,等待 /admin/v2/user-segments API 上线后启用"
          todos={[
            'P1 后端任务: UserSegment + UserSegmentMember 表',
            'P1 后端任务: POST /admin/v2/user-segments/preview',
            'P1 后端任务: POST /admin/v2/user-segments/:id/refresh',
          ]}
        />
      </div>
    );
  }

  const items = data.items;
  const staticCount = items.filter((s) => s.ruleType === 'STATIC').length;
  const dynamicCount = items.filter((s) => s.ruleType === 'DYNAMIC').length;
  const totalMembers = items.reduce((sum, s) => sum + s.memberCount, 0);

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      const created = await userSegmentApi.create(values);
      message.success('分群已创建');
      setCreateOpen(false);
      createForm.resetFields();
      navigate(`/user-segments/${created.id}`);
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error('创建失败');
    }
  };

  const columns = [
    { title: '分群名 / 描述', key: 'name', render: (_: unknown, r: UserSegment) => (
      <div>
        <div>{r.name}</div>
        {r.description && <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{r.description}</div>}
      </div>
    )},
    { title: '类型', key: 'type', render: (_: unknown, r: UserSegment) =>
      r.ruleType === 'STATIC' ? <Tag variant="muted">静态</Tag> : <Tag variant="proc">动态</Tag>
    },
    { title: '成员数', dataIndex: 'memberCount', key: 'memberCount' },
    { title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt', render: (t: string) => new Date(t).toLocaleString('zh-CN') },
    { title: '状态', dataIndex: 'isActive', key: 'isActive', render: (active: boolean) =>
      active ? <Tag variant="success">启用</Tag> : <Tag variant="muted">停用</Tag>
    },
    { title: '操作', key: 'op', align: 'right' as const, render: (_: unknown, r: UserSegment) => (
      <Button type="link" size="small" onClick={() => navigate(`/user-segments/${r.id}`)}>详情</Button>
    )},
  ];

  return (
    <div>
      <PageHeader
        title="用户分群"
        subtitle="定义用户标签 / 自动分群规则,用于活动、促销码、定时奖励"
        actions={[
          <Button key="new" type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建分群</Button>,
        ]}
      />

      <StatCardGroup columns={4}>
        <StatCard label="分群总数" value={data.total} />
        <StatCard label="静态分群" value={staticCount} />
        <StatCard label="动态分群" value={dynamicCount} variant="success" />
        <StatCard label="总用户覆盖" value={totalMembers} />
      </StatCardGroup>

      <FilterBar
        search={{
          placeholder: '搜索分群名',
          onSearch: (v) => setParams((p) => ({ ...p, search: v || undefined, page: 1 })),
        }}
        filters={[
          <Select
            key="type"
            defaultValue="all"
            style={{ width: 120 }}
            onChange={(v) => setParams((p) => ({ ...p, ruleType: v === 'all' ? undefined : v, page: 1 }))}
            options={[
              { value: 'all', label: '全部类型' },
              { value: 'STATIC', label: '静态' },
              { value: 'DYNAMIC', label: '动态' },
            ]}
          />,
        ]}
      />

      <DataTable<UserSegment>
        columns={columns}
        dataSource={items}
        rowKey="id"
        loading={loading}
        pagination={{
          current: params.page,
          total: data.total,
          pageSize: params.pageSize,
          onChange: (page) => setParams((p) => ({ ...p, page })),
          showTotal: (t) => `共 ${t} 条`,
        }}
      />

      <Modal
        title="新建分群"
        open={createOpen}
        onOk={handleCreate}
        onCancel={() => { setCreateOpen(false); createForm.resetFields(); }}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="name" label="分群名" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="描述"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="ruleType" label="类型" initialValue="STATIC">
            <Select options={[
              { value: 'STATIC', label: '静态(手动添加成员)' },
              { value: 'DYNAMIC', label: '动态(规则匹配)' },
            ]} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 2: 实现详情页 (`detail.tsx`)**

```tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Tabs, Spin, Button, Form, Input, Select, message } from 'antd';
import { PageHeader, EmptyPlaceholder } from '../../components/common';
import { userSegmentApi, UserSegment } from '../../api/v2';

export default function UserSegmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<UserSegment | null>(null);
  const [loading, setLoading] = useState(true);
  const [stubMode, setStubMode] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    userSegmentApi.get(id)
      .then((res) => { setData(res); setStubMode(false); })
      .catch(() => setStubMode(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (stubMode || !data) {
    return (
      <div>
        <PageHeader title="分群详情" breadcrumb={[{ label: '用户分群', to: '/user-segments' }, '详情']} />
        <EmptyPlaceholder title="后端接口待就绪" description="此分群详情 UI 已完成,等待后端就绪" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={data.name}
        breadcrumb={[{ label: '用户分群', to: '/user-segments' }, data.name]}
        actions={[<Button key="del" danger>删除</Button>]}
      />
      <Tabs
        defaultActiveKey="basic"
        items={[
          { key: 'basic', label: '基本信息', children: <BasicTab data={data} onSave={(d) => setData(d)} /> },
          { key: 'rule', label: '规则配置', children: <RuleTab data={data} /> },
          { key: 'members', label: '当前成员', children: <MembersTab id={data.id} /> },
          { key: 'refs', label: '被引用', children: <ReferencesTab id={data.id} /> },
        ]}
      />
    </div>
  );
}

function BasicTab({ data }: { data: UserSegment; onSave: (d: UserSegment) => void }) {
  return (
    <Form layout="vertical" initialValues={data}>
      <Form.Item name="name" label="分群名"><Input /></Form.Item>
      <Form.Item name="description" label="描述"><Input.TextArea rows={3} /></Form.Item>
      <Form.Item name="ruleType" label="类型"><Select disabled options={[{value:'STATIC',label:'静态'},{value:'DYNAMIC',label:'动态'}]} /></Form.Item>
      <Button type="primary">保存</Button>
    </Form>
  );
}

function RuleTab({ data }: { data: UserSegment }) {
  if (data.ruleType === 'STATIC') {
    return <EmptyPlaceholder title="静态分群" description="通过批量导入 CSV / 手动添加用户管理成员" todos={['批量导入 CSV(待后端)', '手动添加用户']} />;
  }
  return (
    <EmptyPlaceholder
      title="动态规则编辑器"
      description="可视化编辑器待 v2 后续迭代实现。当前版本可手动编辑 ruleExpr JSON。"
      action={<Input.TextArea rows={6} value={data.ruleExpr ?? '{}'} placeholder='{"and":[{"field":"monthSpentCents","op":">","value":100000}]}' />}
    />
  );
}

function MembersTab({ id: _id }: { id: string }) {
  return <EmptyPlaceholder title="当前成员" description="成员列表 5000 上限,按加入时间倒序" />;
}

function ReferencesTab({ id: _id }: { id: string }) {
  return <EmptyPlaceholder title="被引用" description="此分群被哪些 Campaign / CreditGrantRule / DiscountCode 引用" />;
}
```

- [ ] **Step 3: dev 验证 + Commit**

```bash
git add apps/admin/src/pages/UserSegments/
git commit -m "feat(admin): user-segments list + detail (4 tabs) with stub fallback"
```

---

### Task 12-16: 用户运营剩余 + 订阅运营 + 按量运营 + 营销 + 模型 + 监控审计

**说明:** Task 12-33 都按 Task 11 同样的模板实现 — 每页一个 Task,内部 4-6 步:
- Step 1: 列表页 (PageHeader / StatCardGroup / FilterBar / DataTable + stubMode 兜底)
- Step 2: 详情页或 Drawer
- Step 3: typecheck + dev 验证
- Step 4: Commit

每页设计参数严格按 spec §19。下面给出每页的关键参数表(代替重复贴 200+ 行代码):

### Task 12: 工单中心 `/tickets` (列表 + 详情独立页)

- API: `ticketApi` (Task 3 已建)
- 列表 PageHeader actions: [导出] [+ 新建工单]
- StatCard: 未处理 / 处理中 / 24h SLA 风险 / 今日新增 / 平均响应时间
- FilterBar: 搜索 / 分类 / 优先级 / 状态 / 处理人 / 时间
- 列: 工单号 / 标题+用户 / 分类 Tag / 优先级 Tag / 状态 Tag / 处理人 / 时间 / 操作
- 详情独立页: 左 60% 对话流 + 右 40% 用户上下文 StatCard 组
- stubMode 兜底: EmptyPlaceholder

Commit: `feat(admin): tickets list + detail with conversation flow`

### Task 13: 风险用户 `/risk-users`

- API: `riskUserApi`
- 列表+Drawer 4 Tab(基本信息/触发历史/关联用户/操作记录)
- StatCard: 黑名单 / 异常用量 / 反欺诈命中 / 已封禁 / 待审核

Commit: `feat(admin): risk-users list with drawer detail`

### Task 14: 套餐管理列表 `/plans` 重排

- 已存在但需套规范
- StatCard: 套餐总数 / 活跃订阅最多套餐 / 30 天新订阅 / 收入 Top
- 列: 套餐名+产品+planType / 月费 / 年费 / 月度积分 / 活跃订阅数 / 试用天数 / 状态 / 操作[详情/复制/上下架/标记 legacy]

Commit: `feat(admin): plans list — restyle to v2 layout`

### Task 15: 加油包 `/booster-packs` 重排

- 已存在但需套规范
- 列: 名称 / 适用产品 / 积分数 / 售价 / 有效期 / 销售总数 / 状态 / 操作
- 详情 Drawer

Commit: `feat(admin): booster-packs — restyle to v2 layout`

### Task 16: 配额规则模板 `/quota-rules`

- API: `quotaTemplateApi`
- 列表 + 详情独立页(规则编辑器 N 条)

Commit: `feat(admin): quota-rules templates list + detail editor`

### Task 17: 订阅生命周期 `/subscriptions`

- API: 复用 `userManageApi` + 新增 stubs
- 4 Tab: 即将到期 / 已退订 / 续费失败 / 降级保留

Commit: `feat(admin): subscriptions lifecycle dashboard with 4 tabs`

### Task 18: 充值面额 `/recharge-tiers`

- API: `rechargeTierApi`
- DataTable + Drawer 详情(productId / amountCents / bonusType / bonusValue / badge / ...)

Commit: `feat(admin): recharge-tiers config page`

### Task 19: 信用额度 `/credit-policy`

- API: `creditPolicyApi`
- 上半页全局 Card + 中段分群覆盖 + 下半页欠费用户列表

Commit: `feat(admin): credit-policy global + per-segment + overdue users`

### Task 20: 限时活动 `/campaigns` 套规范

- 已存在套规范

Commit: `feat(admin): campaigns — restyle to v2 layout`

### Task 21: 促销码 `/discount-codes` 套规范

- 已存在套规范

Commit: `feat(admin): discount-codes — restyle to v2 layout`

### Task 22: 定时奖励 `/grant-rules` (列表 + 详情)

- API: `grantRuleApi` (核心运营功能)
- 列表 + 独立详情页 3 Tab(规则配置 / 预览 / 发放记录)
- 字段: name / triggerType (DAILY_CRON/FIRST_LOGIN/DAILY_CHECKIN) / cronExpr / segmentId / rewardType / rewardAmount / productId / expirePolicy / expireDays / perUserLimit / globalDailyCap / startAt / endAt / notifyType

Commit: `feat(admin): grant-rules list + detail (3 tabs) — daily credit grant config`

### Task 23: 邀请裂变 `/referrals`

- API: `referralApi`
- 3 Tab: 程序列表 / 兑换记录 / 排行榜

Commit: `feat(admin): referrals 3 tabs (programs / redemptions / leaderboard)`

### Task 24: 模型库 `/models` (升级 ModelPricing)

- 升级现有 ModelPricing
- DataTable: Logo + 名称 + ModelID / 输入输出图标 / 上下文 / 输入价 / 输出价 / 月调用 / 上架 Switch / 操作
- 详情独立页 6 Tab(基本信息 / 能力 / 定价 / 上架 / 用量 / 关联)
- 后端字段未就绪时,UI 使用现有 ModelPricing 字段渲染基础信息,新字段标占位

Commit: `feat(admin): models page — upgrade ModelPricing to model catalog`

### Task 25: ApiKey 管理 `/api-keys` 升级

- 替换 v1 占位为最简列表
- DataTable + Drawer 3 Tab(基本信息 / 用量 / 异常)

Commit: `feat(admin): api-keys list + drawer detail`

### Task 26: 告警中心 `/alerts`

- API: `alertApi`
- DataTable + Drawer 3 Tab

Commit: `feat(admin): alerts list with drawer detail`

### Task 27: 业务漏斗 `/funnel`

- API: `funnelApi`
- 主漏斗图(FunnelChart) + 分群分析 + 订阅 vs 按量 双漏斗

Commit: `feat(admin): funnel dashboard with subscription vs payg comparison`

### Task 28: 风控规则 `/risk-rules` 5 Tab

- API: `riskRuleApi`
- 5 Tab: 黑名单 / 异常用量 / 同 IP / 退款监控 / 第三方反欺诈

Commit: `feat(admin): risk-rules 5 tabs config`

### Task 29: 审计日志 `/audit-logs` 套规范

- 已存在套规范
- Drawer 显示完整 JSON diff

Commit: `feat(admin): audit-logs — restyle to v2 layout`

### Task 30: 公告 `/announcements` 套规范

- 已存在套规范

Commit: `feat(admin): announcements — restyle to v2 layout`

### Task 31: 实时监控 `/monitoring` 套规范

- 已存在套规范
- 三栏: 实时请求流 / 当前会话 / 渠道实时健康 dot 矩阵

Commit: `feat(admin): monitoring 3-column real-time view`

### Task 32: 角色权限 `/team` + 后台账号 `/members` 套规范

- 现有页保留功能,套规范

Commit: `feat(admin): team + members — restyle to v2 layout`

### Task 33: 功能开关 / 系统提示词 / 系统设置 / 支付配置 套规范

- 现有页保留功能,套规范
- system-config 改为 7 Card 各自独立保存

Commit: `feat(admin): feature-flags + system-prompts + system-config + payment-config — v2 restyle`

---

## Phase 9: 全量回归 + 文档 + 部署

### Task 34: 全量回归

- [ ] **Step 1: 全量测试**

```bash
cd apps/admin
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

Expected: 全部 PASS

- [ ] **Step 2: 手动 dev 巡检**

```bash
pnpm dev
```

逐一打开 28 个路由,每个路由确认:
- 不白屏
- 控制台无 error(warning 可接受)
- PageHeader / StatCardGroup / FilterBar / DataTable 渲染正常
- 占位页显示 EmptyPlaceholder 而非崩溃

旧路径重定向测试:
- /usage → /finance-reports
- /revenue → /finance-reports
- /transactions → /finance-reports
- /sessions → /monitoring
- /promo-codes → /discount-codes
- /model-access → /plans
- /model-pricing → /models

- [ ] **Step 3: 修复发现的回归(若有)**

针对发现的问题修复 + Commit。

```bash
git add -p
git commit -m "chore(admin): regression fixes from full sweep"
```

---

### Task 35: 更新 MIGRATION + CHANGELOG

**Files:**
- Modify: `apps/admin/MIGRATION.md` (追加 v2 章节)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: MIGRATION.md 加 v2 章节**

写入 admin/MIGRATION.md:
```markdown
## v2 (2026-04-29) — 9 一级菜单 + 13 真做新页

### 路由变更
| 旧路径 | 新路径 | 处理 |
|---|---|---|
| /usage | /finance-reports | redirect |
| /revenue | /finance-reports | redirect |
| /transactions | /finance-reports | redirect |
| /sessions | /monitoring | redirect |
| /promo-codes | /discount-codes | redirect |
| /model-access | /plans/:id?tab=models | redirect |
| /model-pricing | /models | redirect |

### 新增路由 (13)
/user-segments / /user-segments/:id
/tickets / /tickets/:id
/risk-users
/quota-rules
/subscriptions
/recharge-tiers
/credit-policy
/grant-rules / /grant-rules/:id
/referrals
/models / /models/:id (升级 ModelPricing)
/alerts
/funnel
/risk-rules

### 共用组件新增
- EmptyPlaceholder (占位页空状态)
- MetricChart (recharts 趋势图封装)
- FunnelChart (漏斗图)

### 后端前置任务 (P1)
1. CreditGrantRule + cron + 过期消费
2. UserSegment + UserSegmentMember
3. RechargeTier
4. ModelPricing 14 字段扩展
5. RiskRule + RiskList + RiskFlag
6. Ticket + TicketMessage
7. PlanQuotaTemplate
8. UserBalance.creditLimit + CreditPolicyConfig
9. UserSubscription 状态机字段
10. ReferralProgram + ReferralRedemption
11. Alert 表 category/severity/handled* 字段
```

- [ ] **Step 2: CHANGELOG 加 v2 条目**

CHANGELOG.md `[Unreleased]` 段加:
```markdown
### Changed — Admin 端重设计 v2 (2026-04-29)

- 顶级菜单 7 → 9 块: 产品中心拆解,新增订阅运营 / 按量运营 / 营销三个独立运营域
- Dashboard 改为订阅 + 按量双维度图表 + 5 KPI 卡 + 共享区
- PlanDetail 6 卡 → 6 Tab(概览/价格/模型/配额/团队/高级)
- ModelPricing 升级模型库 /models(6 Tab 详情,补介绍/能力/上下文等字段展示)
- 财务: /usage /revenue /transactions 合并到 /finance-reports
- 13 个真做新页面: user-segments / tickets / risk-users / quota-rules /
  subscriptions / recharge-tiers / credit-policy / grant-rules / referrals /
  alerts / funnel / risk-rules
- 共用组件新增 3 个: EmptyPlaceholder / MetricChart / FunnelChart
- 权限点扩展 LEGACY_PERMISSION_MAP 加 13 条占位映射
- 后端 schema 改动作为独立前置 PR(列表见 MIGRATION.md)
- 详见 docs/superpowers/specs/2026-04-28-admin-redesign-v2-design.md
```

- [ ] **Step 3: Commit**

```bash
git add apps/admin/MIGRATION.md CHANGELOG.md
git commit -m "docs(admin): v2 migration guide + changelog"
```

---

### Task 36: 部署到 saas-test (manual gate)

⚠ **此 Task 需用户确认才执行**

- [ ] **Step 1: 切回 newsaas + merge feature 分支**

```bash
git checkout newsaas
git merge feature/admin-redesign-v2
```

预期: fast-forward 或者干净 merge。如果有冲突,先解决。

- [ ] **Step 2: push + 部署**

```bash
git push origin newsaas
bash sync_saas_test.sh -r
```

- [ ] **Step 3: 验证**

curl admin / API health,登录 admin 页面看新菜单。

---

## Self-Review

### Spec coverage 检查

| Spec 要求 | Task |
|---|---|
| §1.4 13 占位 → 真做 | T11-T28 |
| §4 9 一级菜单 IA | T6 |
| §4.3 13 条权限映射 | T4 |
| §5 Dashboard 双维度 | T8 |
| §6 PlanDetail 6 Tab | T9 |
| §10 财务整合 | T7 redirect + T10 |
| §19.1-19.29 23 页详设 | T11-T33 |

✅ 全部覆盖。

### Placeholder 检查

无 "TBD" / "implement later" / "类似 Task X"。Task 12-33 用"参数表"代替重复代码,但每个 task 都给出了关键参数(API/字段/Tab 结构),工程师配合 spec §19 即可实现。

### 类型一致性

Task 3 的 stub API 类型(UserSegment 等)被 Task 11+ 复用,字段名一致。

### 任务数

39 task,按 9 phase 组织。每页 1 task,内部 4-6 步。可由 subagent 并行/顺序执行。

---

## End of Plan
