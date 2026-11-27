# Admin 端重设计迁移指南

> 本文档记录 2026-04-27 ~ 2026-04-28 admin 端重设计的迁移要点，供后续添加新页面 / 改造剩余页面时参考。

## 路由变更

| 旧路径 | 新路径 | 处理 |
|---|---|---|
| `/transactions` | `/usage` | redirect (Navigate replace) |
| `/sessions` | `/monitoring` | redirect |
| `/members` | `/team` | redirect |
| `/plan-templates` | `/plans` | redirect |
| `/plan-templates/:id` | `/plans/:id` | redirect (param forwarding via helper) |
| `/booster-packs` | `/plans` | redirect |
| `/promo-codes` | `/plans` | redirect |
| `/model-access` | `/plans` | redirect (功能折叠到 PlanDetail) |

新增：`/api-keys`（占位页）、`/403`（Forbidden 页）。

权限映射见 `src/hooks/useLegacyPermission.ts` 的 `LEGACY_PERMISSION_MAP`。后端权限 key 不变，前端做映射。

## 共用组件

新 `src/components/common/` 目录：

| 组件 | 用途 |
|---|---|
| `PageHeader` | 页面顶部：标题 + 副标题 + 面包屑 + 操作按钮 |
| `StatCard` / `StatCardGroup` | 统计卡（4 列响应式网格） |
| `FilterBar` | 横向单行筛选栏（搜索 + 多选 + chip） |
| `DataTable<T>` | AntD Table 封装，统一表头 / hover / 选中 |
| `DetailDrawer` | 右侧滑出详情，Tabs + 状态 + 操作 |
| `Tag` | 受控 variant：`success / warn / error / proc / muted` |

barrel: `import { ... } from '@/components/common'`。

## 设计 token

`src/styles/theme.ts` 镜像自 `codesphere-frontend-saas/src/styles/theme.ts`（stsoft V1）。

CSS 变量定义在 `src/styles/tokens.css`，命名规则：

- 颜色：`--bg-body / --bg-panel / --primary / --accent / --text* / --border*`
- 状态：`--success / --warning / --error / --info` 各带 `-bg` `-text` 变体
- 圆角：`--radius-card: 8 / --radius-modal: 16 / --radius-pill: 999`
- 字号：`--fs-xs (11) / --fs-sm (12) / --fs-base (13) / --fs-md (14) / --fs-lg (16) / --fs-xl (18) / --fs-2xl (22)`

**禁止**在组件代码里 inline `style={{ color: '#xxx' }}`，必须走 token。

## Tag 颜色规约

```
success → 启用 / 已支付 / 健康
warn    → 待激活 / 波动 / 待处理
error   → 异常 / 失败 / 停用
proc    → 充值中 / 退款中 / 流转中
muted   → 中性标签（产品名 / 类型）
```

不要再使用 AntD Tag 的 `color="gold/cyan/purple/..."`。

## 全局上下文

- `ProductContext` (`src/contexts/ProductContext.tsx`)：当前产品筛选器，`useProduct() / useCurrentProduct()`。localStorage 7 天 TTL。
- 顶部产品筛选器在 `src/components/Layout/ProductSwitcher.tsx`。

## 改造剩余页面的建议

每个页面遵循同一套规范：
1. 顶部用 `PageHeader`
2. 统计区用 `StatCardGroup`
3. 列表筛选用 `FilterBar`
4. 表格用 `DataTable`
5. 详情用 `DetailDrawer` 或 PageHeader+breadcrumb 独立路由
6. Tag 颜色限定 5 种 variant
7. 操作按钮：`type="primary"` (主) / 默认 (次) / `danger` (危险)

## 测试约束

- 共用组件测试覆盖率 ≥ 95%
- 整体覆盖率门槛：lines/funcs/stmts ≥ 85%, branches ≥ 80%（vitest config 强制）
- 测试位置：与组件并列的 `__tests__/` 文件夹

## 已知 TODO（数据补齐）

详见各页面源代码内的 `TODO` 注释：

- Dashboard 支付成功率 / 异常订单 — 待后端聚合接口
- UserDetail LTV（累计消费 / 退款 / 净收入）— 待 ordersApi.list 支持 userId
- Revenue 按 billingMode 拆分 — 待 Product.billingMode 字段
- ProductSwitcher 的产品 billingMode — 同上

## Spec / Plan 引用

- 设计 spec: `docs/superpowers/specs/2026-04-27-admin-redesign-design.md`
- 实施 plan: `docs/superpowers/plans/2026-04-27-admin-redesign.md`

---

## v2 (2026-04-29) — 9 一级菜单 + 13 个新真做页 + 后端前置

### 路由变更

新增 17 个路由：
- `/user-segments` `/user-segments/:id` 用户分群
- `/tickets` `/tickets/:id` 工单中心
- `/risk-users` 风险用户
- `/quota-rules` 配额规则模板
- `/subscriptions` 订阅生命周期
- `/recharge-tiers` 充值面额
- `/credit-policy` 信用额度
- `/grant-rules` `/grant-rules/:id` 定时奖励
- `/referrals` 邀请裂变
- `/models` `/models/:id` 模型库（升级 ModelPricing）
- `/alerts` 告警中心
- `/funnel` 业务漏斗
- `/risk-rules` 风控规则

新增 redirect: `/model-pricing` → `/models`

### 一级菜单结构

7 → 9 块: 总览 / 用户运营 / 订阅运营 / 按量运营 / 营销 / 模型与渠道 / 财务中心 / 监控审计 / 系统

### 共用组件新增

- `EmptyPlaceholder` 占位页空状态（title + description + todos[] + action）
- `MetricChart<T>` recharts 趋势图封装
- `FunnelChart` 漏斗图

### 升级页面

- **Dashboard**: 4 卡 + 4 panel → 5 KPI + 订阅维度区 + 按量维度区 + 共享 3 panel
- **PlanDetail**: 6 张密集卡片 → 6 个 Tab（概览/价格/模型/配额/团队/高级）
- **ModelPricing → Models**: 列表升级为模型库视图，详情 6 Tab
- **FinanceReports**: PageHeader 加产品筛选器联动

### v1 已存在但 v2 套规范

`/plans` `/booster-packs` `/campaigns` `/discount-codes` `/team` `/members`
`/feature-flags` `/system-prompts` `/system-config` `/payment-config`
`/monitoring` `/audit-logs` `/announcements`

### 占位 API stub（11 个模块）

`apps/admin/src/api/v2/`:
- userSegments / tickets / riskUsers / riskRules / grantRules
- referrals / rechargeTiers / creditPolicy / quotaTemplates / alerts / funnel

每个模块定义 TS 类型 + 调用 `/admin/v2/*` endpoint。后端 404 时前端 catch 并显示 `EmptyPlaceholder`。

### 权限映射扩展

`LEGACY_PERMISSION_MAP` 加 13 条占位映射:
```
admin.user_segments.manage    → users.segments.manage
admin.tickets.manage          → users.tickets.manage
admin.risk.users.manage       → users.risk.manage
admin.quota_rules.manage      → products.subscriptions.quota.manage
admin.subscriptions.manage    → products.subscriptions.lifecycle.manage
admin.recharge_tiers.manage   → products.payg.tiers.manage
admin.credit_policy.manage    → products.payg.policy.manage
admin.grant_rules.manage      → marketing.grants.manage
admin.referrals.manage        → marketing.referrals.manage
admin.alerts.manage           → audit.alerts.manage
admin.funnel.read             → audit.funnel.read
admin.risk.rules.manage       → audit.risk.manage
admin.api_keys.manage         → ops.apikeys.manage
```

### 后端前置任务（优先级 P1）

1. `CreditGrantRule` 表 + cron + `CreditTransaction.expiresAt/grantRuleId/isExpired`
2. `UserSegment` + `UserSegmentMember` 表 + 规则引擎 + preview 接口
3. `RechargeTier` 表
4. `ModelPricing` 14 字段扩展 (provider/modelId/description/inputModalities/outputModalities/contextLength/maxOutputTokens/providerLogo/isPublished/displayOrder/releaseAt/tags/supportedFeatures/cachedInputPriceCents/batchDiscount)
5. `RiskRule` + `RiskList` + `RiskFlag` 表
6. `Ticket` + `TicketMessage` 表
7. `PlanQuotaTemplate` 表 + `PlanQuotaRule.templateId`

### 后端前置任务（优先级 P2）

8. `UserBalance.creditLimit` 字段 + `CreditPolicyConfig` 表
9. `UserSubscription` 状态机字段 (autoRenew/nextBillingAt/cancellationReason/winbackOffered/lastRenewalFailedAt)
10. `ReferralProgram` + `ReferralRedemption` 表
11. `Alert` 表扩展 (category/severity/handledAt/handledBy/handledNote)

### v2 Spec / Plan 引用

- 设计 spec: `docs/superpowers/specs/2026-04-28-admin-redesign-v2-design.md`
- 实施 plan: `docs/superpowers/plans/2026-04-29-admin-redesign-v2.md`
