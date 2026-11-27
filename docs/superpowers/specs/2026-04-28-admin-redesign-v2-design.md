# Admin 端重设计 v2 · Design Spec

- **Date**: 2026-04-28
- **Scope**: codesphere-admin-saas / apps/admin
- **Owner**: 运营管理后台前端
- **Status**: Approved (brainstorm v2 完成)
- **Predecessor**: `2026-04-27-admin-redesign-design.md` (v1 已部署到 saas-test)
- **Next**: writing-plans 生成实施计划

---

## 1. 背景与目标

### 1.1 v1 已交付（2026-04-27）

v1 完成了视觉规范统一、5 个共用组件、5 个样板页面、IA 第一版（27 → 21 页）。
但运营人员反馈："产品中心" 把订阅 / 按量 / 加油包 / 活动 / 促销码 全堆在一起，
不同业务模式被混在一个域里看，"东一块西一块"。

### 1.2 v2 目标

1. **重新切分顶级 IA**：把"产品中心"拆解，按业务模式分两个独立的运营域
   （**订阅运营** / **按量运营**），并把跨模式共享的能力（营销 / 风控 / 数据）独立成块
2. **补齐运营策略**：调研同类 SaaS / AI API 平台后梳理出一份完整运营玩法清单，
   决定哪些纳入 v2 真做、哪些先占位、哪些砍掉
3. **整合财务模块**：现有 `/finance-reports` 是完整对账报表，应作为财务中心主入口，
   取代 `/usage` 和 `/revenue`（后者是前者的子集）
4. **PlanDetail 解构**：6 张密集卡片 → 6 个 Tab，按职责分离
5. **ModelPricing 升级模型库**：补齐用户侧能看到的"模型介绍 / 能力 / 上下文"等展示数据
6. **Dashboard 改为双维度图表**：订阅维度 + 按量维度并列展示，运营一眼看到两套业务健康度

### 1.3 非目标（本次不做）

- ❌ 改后端业务逻辑（计费扣款 / 订单状态机 / Stripe / Webhook）
- ❌ 改后端 schema：v2 新增的所有表（CreditGrantRule / UserSegment / RechargeTier /
  Ticket / RiskFlag / RiskRule / RiskList / ReferralProgram / PlanQuotaTemplate /
  CreditPolicyConfig 等）作为**前置后端任务**，独立 PR 推进
- ❌ 完整新功能开发：v2 仅做 admin 前端 UI + 路由 + 权限映射 + 占位空状态。
  实际数据流转待后端 schema/API 落地后再接

### 1.4 v2 升级版策略（基于用户 2026-04-28/29 反馈）

- **23 页全部真做**：v2 spec §19 给出每页详细设计（PageHeader / StatCard / FilterBar /
  DataTable / 详情页）。前端按设计落地完整 UI，后端未就绪的字段/操作显示空状态 + 禁用按钮 + tooltip
- **风控全面纳入**：用户层（`/risk-users`）+ 规则层（`/risk-rules`）+ 告警入口（`/alerts`）
  三块联动
- **Dashboard 双维度图表**：订阅区 + 按量区 + 共享区
- **后端前置任务 P1 全部计入**：见 §13.1

### 1.5 红线（与 v1 一致）

- 后端权限 key 不动，前端通过 `LEGACY_PERMISSION_MAP` 映射
- 路由合并 ≠ 删 API
- 不修改 Order/Subscription 等业务枚举
- 不动 Stripe / Alipay / Wechat 集成

---

## 2. v1 → v2 关键变更

| 维度 | v1 | v2 |
|---|---|---|
| 一级菜单数 | 7 (总览/用户/产品/财务/模型/审计/系统) | 9 (总览/用户/订阅/按量/营销/模型/财务/审计/系统) |
| 产品中心 | `/products` + `/plans` (合并 PlanTemplates/BoosterPacks/Campaigns/DiscountCodes) | **拆解**：套餐进订阅运营、加油包进订阅运营、活动+促销码进营销 |
| 财务中心 | `/orders` + `/usage` + `/revenue` + `/payment-config` | `/orders` + `/finance-reports` + `/payment-config`（合并 usage + revenue → finance-reports） |
| Dashboard | 4 卡 + 4 panel | 5 卡 + 订阅维度区 + 按量维度区 + 共享区 |
| PlanDetail | 6 张密集卡片同页 | 6 个 Tab（概览 / 价格 / 模型 / 配额 / 团队 / 高级） |
| ModelPricing | 5 列定价表 | 升级为模型库（含介绍 / 能力图标 / 上下文 / Provider Logo） |
| 新增模块 | 0 | 营销（独立菜单）+ 风控（用户层 + 规则层）+ 业务漏斗 |
| 新增占位页 | 1（ApiKeys） | 13 |

---

## 3. 业务模型确认（与 v1 一致，更精确）

### 3.1 三种 billingMode

| Mode | 用户付费心智 | 加油包 | Key | 配额耗尽 |
|---|---|---|---|---|
| `SUBSCRIPTION` | 月费 → 月度积分 | ✅ 有 | 通常无（Web 端消费） | 等下月或买加油包 |
| `CODING_PLAN` | 月费 → 5h/7d/月 滚动配额 | ❌ 无 | ✅ Key 消费配额 | 直接限流 (429) |
| `PAY_AS_YOU_GO` | 充值预付余额 | ❌ 无（用充值阶梯代替） | ✅ Key 扣余额 | 拒服务或欠费 |

### 3.2 admin 视角的"运营对象"

| 对象 | 数量 | 模式归属 |
|---|---|---|
| Product | N（如 CodingPlan / AI 写作 / AI 对话）| 每个绑定一种 billingMode |
| Plan | N × M | 仅 SUBSCRIPTION + CODING_PLAN 用 |
| BoosterPack | N | 仅 SUBSCRIPTION 用 |
| RechargeTier (新) | N | 仅 PAY_AS_YOU_GO 用 |
| Campaign | N | 跨模式（活动绑定 Plan/Tier） |
| DiscountCode | N | 跨模式 |
| CreditGrantRule (新) | N | 跨模式（"每日送积分"等定时奖励） |
| UserSegment (新) | N | 跨模式（用户标签 + 自动分群规则） |
| ModelPricing | N | 平台共享（所有产品引用） |
| Channel | N | 平台共享（上游路由） |

---

## 4. 顶级 IA（v2 最终版）

### 4.1 9 个一级菜单

```
总览           /                       — Dashboard 双维度图表
用户运营        ─┬─ /users             — 用户列表
                ├─ /users/:id         — 用户详情
                ├─ /user-segments     🟡 用户分群 (占位)
                ├─ /tickets           🟡 工单中心 (占位)
                └─ /risk-users        🟡 风险用户 (占位)
订阅运营        ─┬─ /plans            — 套餐管理 (6 Tab 详情页)
                ├─ /plans/:id        — 套餐详情
                ├─ /booster-packs    — 加油包
                ├─ /quota-rules      🟡 配额规则 (CodingPlan 专用,占位)
                └─ /subscriptions    🟡 订阅生命周期 (占位:续订/降级/挽回)
按量运营        ─┬─ /recharge-tiers  🟡 充值面额 (占位)
                └─ /credit-policy    🟡 信用额度 (占位:欠费/超额策略)
营销           ─┬─ /campaigns        — 限时活动
                ├─ /discount-codes   — 促销码
                ├─ /grant-rules      🟡 定时奖励 (占位:每日送积分等)
                └─ /referrals        🟡 邀请裂变 (占位)
模型与渠道     ─┬─ /models           — 模型库 (升级 ModelPricing)
                ├─ /channels         — 渠道管理
                └─ /api-keys         🟡 ApiKey 管理 (占位升级)
财务中心       ─┬─ /orders           — 订单管理 (运营动作)
                ├─ /finance-reports  — 财务报表 (8 Tab,取代 /usage 和 /revenue)
                └─ /payment-config   — 支付配置
监控审计       ─┬─ /monitoring        — 实时监控
                ├─ /alerts           🟡 告警中心 (占位)
                ├─ /funnel           🟡 业务漏斗 (占位)
                ├─ /risk-rules       🟡 风控规则 (占位:黑名单/反欺诈/退款率)
                ├─ /audit-logs       — 审计日志
                └─ /announcements    — 公告
系统           ─┬─ /team             — 角色权限
                ├─ /members          — 后台账号
                ├─ /feature-flags    — 功能开关
                ├─ /system-prompts   — 系统提示词
                └─ /system-config    — 系统设置
```

总计 **28 个路由**，其中 **13 个占位**（前端 UI 落地，后端 schema 待补）。

### 4.2 与 v1 的路由变更

新增（v2 独有）:
- `/booster-packs` — 从"产品中心 / 套餐与活动"中独立出来
- `/user-segments` `/tickets` `/risk-users`
- `/quota-rules` `/subscriptions`
- `/recharge-tiers` `/credit-policy`
- `/grant-rules` `/referrals`
- `/alerts` `/funnel` `/risk-rules`

合并并简化（v1 已存在但 v2 重新归类）:
- `/campaigns` `/discount-codes` 从产品中心移到营销
- `/models` 从模型与渠道升级为"模型库"
- `/finance-reports` 取代 `/usage` `/revenue`

兼容旧路径 (Navigate redirect):
- `/usage` → `/finance-reports?tab=apiUsage`
- `/revenue` → `/finance-reports?tab=summary`
- `/transactions` → `/finance-reports?tab=balance`
- `/sessions` → `/monitoring`
- `/plan-templates` → `/plans`
- `/plan-templates/:id` → `/plans/:id`
- `/promo-codes` → `/discount-codes`
- `/model-access` → `/plans/:id?tab=models`
- `/model-pricing` → `/models`

### 4.3 v1 → v2 权限点扩展

`LEGACY_PERMISSION_MAP` 现有 24 条 + 新增 13 条占位映射:

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

实施时:
- 后端权限 key 暂未注册的(占位页)，前端 `usePermission` 检查时**默认通过**(给 super_admin),其他角色显示"功能开发中"按钮。
- 后端就绪后,在 `LEGACY_PERMISSION_MAP` 加入真实映射,移除"默认通过"。

---

## 5. Dashboard 双维度看板设计

### 5.1 整体布局

```
┌──────────────────────────────────────────────────────────────┐
│ PageHeader: 运营总览 · 当前范围 [产品筛选器] · 近 30 天 ▼     │
├──────────────────────────────────────────────────────────────┤
│ 顶部 KPI (5 卡) — 跨业务核心指标                              │
│ ┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐                  │
│ │总用户 ││MRR   ││本月  ││异常  ││告警  │                  │
│ │      ││(订阅)││收入  ││订单  ││未处理│                  │
│ └──────┘└──────┘└──────┘└──────┘└──────┘                  │
├──────────────────────────────────────┬───────────────────────┤
│ ─── 订阅维度 ───                     │ ─── 按量维度 ───      │
│                                      │                       │
│ • 订阅 MRR 趋势(面积图,30 天)         │ • 按量收入趋势        │
│ • 套餐分布(饼图,按 plan)              │ • 充值漏斗            │
│ • 活跃订阅 / 续订率 / 流失率(数字)    │ • 余额分布(直方图)    │
│ • 即将到期 / 已退订(列表 + 操作)       │ • 余额告警(列表)      │
│ • 配额耗尽 Top 10(列表)               │ • 高消耗用户 Top 10   │
├──────────────────────────────────────┴───────────────────────┤
│ ─── 共享区 ─── (跨业务)                                       │
│ ┌─最近订单───────┐┌─系统告警───────┐┌─模型渠道健康─────┐     │
│ │ 5 笔最新       ││ 未处理告警     ││ 健康/异常/波动   │     │
│ │ + 状态 dot     ││ + 严重度       ││ + 趋势           │     │
│ └────────────────┘└────────────────┘└──────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 订阅维度组件

| 组件 | 数据源 | 备注 |
|---|---|---|
| MRR 趋势 | sum(active subscriptions × monthly price) by 日 | 面积图,recharts |
| 套餐分布 | count(active subscriptions) group by planId | 饼图 |
| 活跃订阅数 | count where status=ACTIVE | StatCard |
| 续订率 | renewals / expirations × 100% | StatCard,需新聚合 API,先用占位 |
| 流失率 | (cancelled+expired) / active × 100% | 同上 |
| 即将到期 | expiresAt < now() + 7 days | 列表,7 天内 |
| 配额耗尽 Top 10 | CodingPlan 用户 quota_used / quota_limit > 80% | 列表 |

### 5.3 按量维度组件

| 组件 | 数据源 | 备注 |
|---|---|---|
| 按量收入趋势 | sum(orders.amountCents where orderType=RECHARGE) by 日 | 面积图 |
| 充值漏斗 | 注册→首充→二次充→月充>500 | 桑基/漏斗图 |
| 余额分布 | UserBalance.balanceCents 分桶 | 直方图 |
| 余额告警 | balanceCents < threshold | 列表 |
| 高消耗用户 | sum(BalanceTransaction where type=DEDUCT) Top 10 | 列表 |

### 5.4 数据来源

- 短期: 复用现有 `dashboardApi.stats()` + `ordersApi.list()` + `userManageApi.search()` 客户端聚合
- 长期: 后端新增 `/admin/dashboard/v2` 聚合接口,返回上述所有指标的预计算数据

实施策略:
- v2 落地: 客户端聚合 + 部分指标用占位 "—",标 TODO
- 后端 v2 接口完成后切换

---

## 6. 订阅运营模块详设

### 6.1 套餐管理 (`/plans`) - 列表

PageHeader (标题 / 副标题 / [+ 新建套餐])
StatCardGroup: 套餐总数 / 活跃用户最多套餐 / 最近 30 天新订阅数 / 收入 Top 套餐
FilterBar: 搜索 + 产品 + 套餐类型(individual/team/enterprise) + 状态
DataTable:

| 列 | 内容 |
|---|---|
| 套餐名 | + 副标题(planType / 月费 / 年费) |
| 适用产品 | Tag |
| 月度积分 | 数字 |
| 活跃订阅数 | 数字(链接到用户列表过滤) |
| 状态 | active/legacy/inactive Tag |
| 操作 | 详情 / 复制 / 上下架 |

### 6.2 套餐详情 (`/plans/:id`) - 6 Tab 重组

**重组前 v1 的 6 张密集卡片**:
基本信息 / 计费与积分 / 多币种定价 / 速率与团队 / 功能与合规 / 模型与积分配置

**重组后 v2 的 6 个 Tab**:

| Tab | 内容 | 来源卡片 |
|---|---|---|
| 概览 | 套餐名 / 描述 / 计费类型 / 月费 / 年费 / 月度积分 / 上下架 | 基本信息 + 计费与积分(基础部分) |
| 价格 | 多币种定价(PlanPrice 表 CRUD,USD/CNY/EUR/SGD) + 试用天数 | 多币种定价 + 计费与积分(试用部分) |
| 模型 | 允许使用的模型组(ModelAccess 关联编辑) + 每个模型的积分倍率 | 模型与积分配置 + 旧 ModelAccess 页 |
| 配额 | 5h/7d/月窗口规则(CodingPlan 类型才显示)+ 速率限制(RPM/TPM)+ 上下文窗口 | 速率与团队(速率部分) + 新增 PlanQuotaRule |
| 团队 | 席位上限(memberLimit) + 最少席位(minimumSeats) + 共享配额规则 | 速率与团队(团队部分) |
| 高级 | 超额策略(overageEnabled, usageMultiplier) + 自动续费规则 + 数据训练同意 + 支持等级 + SSO + 优先访问 | 功能与合规 |

每 Tab 内字段相关性高,无关字段不再串味。

### 6.3 加油包 (`/booster-packs`)

从 v1 "套餐与活动 Tab" 独立出来,单独成页。
PageHeader / StatCardGroup(总数 / 销售总额 / Top 销售加油包)/ FilterBar / DataTable
列: 名称 / 适用产品 / 积分数 / 价格 / 销售数 / 状态 / 操作
保留现有 BoosterPack CRUD 逻辑,仅重排视觉。

### 6.4 配额规则 (`/quota-rules`) 🟡 占位

CodingPlan 模式专用。占位页内容:
- PageHeader 标题"配额规则"
- 空状态: "配额规则用于 CodingPlan 类型套餐,定义滚动 5h/7d/累计 30d 等窗口"
- TODO 表单(可后续真实交互): 选择 plan + 添加 rule(windowType / duration / metric / limit / modelGroup)
- 数据存储待 `PlanQuotaRule` schema 落地

### 6.5 订阅生命周期 (`/subscriptions`) 🟡 占位

订阅运营人员看板。占位内容:
- StatCardGroup: 活跃 / 即将到期(7 天内) / 已退订未挽回 / 续费成功率
- Tab 切换: 即将到期 / 已退订 / 异常订阅 / 自动续费失败
- 每个 Tab 一个用户列表 + 批量发券/挽回操作按钮(占位)

---

## 7. 按量运营模块详设

### 7.1 充值面额 (`/recharge-tiers`) 🟡 占位

后端新表 `RechargeTier`:
```prisma
model RechargeTier {
  id           String   @id @default(uuid())
  productId    String
  amountCents  Int      // 充值金额(分)
  bonusCents   Int      // 赠送金额(分)
  bonusType    String   // FIXED(固定) / PERCENT(百分比)
  isActive     Boolean
  sortOrder    Int
  badge        String?  // "最受欢迎"等
}
```

UI: PageHeader / StatCardGroup / DataTable 列出当前面额配置 + CRUD 表单。

### 7.2 信用额度 (`/credit-policy`) 🟡 占位

按量产品的"欠费策略"。占位内容:
- 全局开关: 是否允许欠费
- 默认信用额度(分): 0 / 100 / 1000
- 用户级覆盖: VIP 用户独立信用额度
- 欠费用户列表(余额 < 0 的用户)

数据存储: UserBalance 加 `creditLimit` 字段(待后端)。

---

## 8. 营销模块详设

### 8.1 限时活动 (`/campaigns`)

复用现有页面,移到营销菜单下。无重大改动。

### 8.2 促销码 (`/discount-codes`)

复用现有页面,移到营销菜单下。无重大改动。

### 8.3 定时奖励 (`/grant-rules`) 🟡 占位 — **运营核心需求**

承载"每天送 300 积分当天过期"等场景。后端新表:

```prisma
model CreditGrantRule {
  id              String   @id @default(uuid())
  name            String                                  // "每日免费 300 积分"
  triggerType     String                                  // DAILY_CRON / FIRST_LOGIN /
                                                          // DAILY_CHECKIN / TASK_COMPLETE / WEEKLY_CRON
  cronExpr        String?                                 // DAILY_CRON 时用,如 "0 0 * * *"
  segmentId       String?                                 // 用户分群 id(空=所有用户)
  rewardType      String                                  // CREDIT / BALANCE / BOOSTER_PACK
  rewardAmount    Int                                     // 积分数 or 分
  productId       String?                                 // 适用产品(空=全局)
  expirePolicy    String                                  // PERMANENT / SAME_DAY_END /
                                                          // N_DAYS / NEXT_RESET
  expireDays      Int?                                    // expirePolicy=N_DAYS 时用
  perUserLimit    Int      @default(1)                    // 每用户单次触发上限
  globalDailyCap  Int?                                    // 全局当日发放总量上限
  isActive        Boolean  @default(true)
  startAt         DateTime?
  endAt           DateTime?
  notifyType      String?                                 // INAPP / EMAIL / SMS / NONE
  notifyTemplate  String?                                 // 模板 ID
}
```

`CreditTransaction` 加字段:
```
+ expiresAt      DateTime?  // 该笔积分过期时间(null=永久)
+ grantRuleId    String?
+ isExpired      Boolean    @default(false)
```

扣减逻辑改为按 `expiresAt ASC` 优先扣最快过期。
凌晨 cron 标记过期 + 反向流水。

UI 占位:
- DataTable 列出所有规则
- 详情/编辑表单 (上面 schema 字段全展示)
- 触发预览(模拟运行)

### 8.4 邀请裂变 (`/referrals`) 🟡 占位

后端新表:
```prisma
model ReferralProgram {
  id              String
  name            String
  inviterReward   Int        // 邀请人奖励(积分)
  inviteeReward   Int        // 被邀请人奖励
  rewardCondition String     // 注册即送 / 首充触发 / 订阅触发
  isActive        Boolean
  startAt / endAt
}
model ReferralRedemption {
  id              String
  programId       String
  inviterUserId   String
  inviteeUserId   String
  triggeredAt     DateTime
  rewardGranted   Boolean
}
```

UI 占位: 程序列表 + 兑换记录 + 排行榜。

---

## 9. 模型与渠道详设

### 9.1 模型库 (`/models`) — **升级 ModelPricing**

参考用户截图(OpenRouter 模型市场风格),展示用户侧需要看到的全量信息:

`ModelPricing` 表新增字段(后端前置):
```
+ provider          String        // openai / anthropic / qwen / deepseek / google / ...
+ modelId           String        // "openai/gpt-5.5"
+ description       String        @default("")  // 中文 markdown
+ inputModalities   String        // JSON 数组: ["text","image","file","audio","video"]
+ outputModalities  String
+ contextLength     Int           @default(0)
+ maxOutputTokens   Int           @default(0)
+ providerLogo      String?       // URL
+ isPublished       Boolean       @default(false)  // 用户侧可见
+ displayOrder      Int           @default(0)
+ releaseAt         DateTime?
+ tags              String        @default("[]")   // ["推理","编码","视觉","快速"]
+ supportedFeatures String        @default("[]")   // ["function_call","streaming","caching",...]
```

**Admin 列表布局**:
```
PageHeader: 模型库 · 共 156 个模型 [+ 新建] [批量上下架]
FilterBar: 搜索 / Provider / 输入类型 / 输出类型 / 上下文长度档位 / 上架状态 / 标签
DataTable:
  - Logo + 名称 + ModelID
  - 输入/输出类型(图标)
  - 上下文长度
  - 输入价 / 输出价 (cents/M token)
  - 月调用量 (token)
  - 上架开关
  - 操作 (详情 / 批量定价 / 复制配置)
```

**Admin 详情 Tab**:
- 基本信息: 名称 / Provider / ModelID / 描述(markdown 编辑) / 标签
- 能力: 输入/输出 modalities (多选) / 上下文长度 / 最大输出 / 支持特性
- 定价: 输入价 / 输出价 / cached input 价 / batch 折扣
- 上架: isPublished / displayOrder / releaseAt / providerLogo URL
- 用量: 调用量趋势 + Top 10 用户 + Top 10 渠道

**用户侧渲染** (apps/web,本次不实施,但 admin 数据要支持):
- 卡片网格,每卡显示 Logo / 名称 / 描述 / 输入输出图标 / 上下文 / 价格
- 详情页 markdown 介绍 + 能力雷达图 + 价格对比

### 9.2 渠道管理 (`/channels`)

v1 已重设计完成,无变更。

### 9.3 ApiKey 管理 (`/api-keys`)

v1 是占位页。v2 升级最简可用版:
- 列表: 所有用户的 Key,可按产品/用户筛选
- 列: prefix / 用户 / 产品 / 创建时间 / 最近使用 / 月用量 / 状态
- 操作: 启停 / 删除 / 重置

---

## 10. 财务中心整合

### 10.1 现状重合分析

| 旧页面 | 内容 | finance-reports 对应 Tab |
|---|---|---|
| `/usage` (Transactions) | 积分/余额流水列表 | 积分套餐流水 + 余额流水明细 |
| `/revenue` | 收入分析图表 | 月度对账汇总 |
| `/orders` | 订单列表 + 退款操作 | 收入订单明细(只读) |

### 10.2 v2 财务中心结构

```
/orders              订单管理(运营动作 — 退款/补单/状态调整,带审计时间线)
/finance-reports     财务报表(已有 8 Tab,作为唯一报表入口)
                       Tab: 月度对账汇总 / 收入订单明细 / 收款渠道对账
                            余额流水明细 / 积分套餐流水 / API 用量扣费
                            供应商成本 / 字段映射与缺口
/payment-config      支付配置(Stripe / WeChat / Alipay 等渠道开关 + 密钥管理)
```

旧路径 `/usage` 和 `/revenue` 通过 `<Navigate>` 重定向到 `/finance-reports` 对应 Tab(URL 加 `?tab=...` 参数)。

---

## 11. 监控审计与风控

### 11.1 实时监控 (`/monitoring`)

v1 已完成(合并 Sessions + Monitoring),无变更。

### 11.2 告警中心 (`/alerts`) 🟡 占位

接入 schema 已有的 `Alert` 表。占位:
- StatCardGroup: 未处理 / 已处理 / 严重 / 中等 / 低
- DataTable: 时间 / 类型 / 主体 / 严重度 / 状态 / 操作
- 告警规则配置入口(链接到 `/risk-rules`)

### 11.3 业务漏斗 (`/funnel`) 🟡 占位

转化漏斗看板。占位:
- 注册 → 邮箱验证 → 首次激活 → 首次付费 → 二次付费 → 月活 → 续订
- 每步显示绝对数 + 转化率 + 与上周对比

### 11.4 风控规则 (`/risk-rules`) 🟡 占位

接入用户回复中要求的风控能力:
- **黑名单**: email / domain / IP / card hash / 用户 ID 添加到黑名单(拒绝注册/付款)
- **异常用量**: 可配置阈值(单日 token 超 X / 单日扣费超 ¥Y),触发后自动停用 Key
- **同 IP 多账号**: 阈值 + 自动告警
- **退款率监控**: 全局/per 产品退款率超阈值告警
- **反欺诈接入点**: 第三方服务接入配置(FingerprintJS / reCAPTCHA / 风控厂商)
- **数据导出/销毁请求**: GDPR/PIPL 合规

后端 schema:
```prisma
model RiskRule {
  id          String
  ruleType    String   // BLACKLIST / USAGE_THRESHOLD / IP_LIMIT / REFUND_RATE / FRAUD_PROVIDER
  config      String   // JSON
  action      String   // BLOCK / ALERT / DISABLE_KEY / FREEZE_USER
  isActive    Boolean
}
model RiskList {
  id          String
  listType    String   // EMAIL / DOMAIN / IP / CARD_HASH / USER_ID
  value       String
  reason      String
  addedBy     String
  expiresAt   DateTime?
}
```

UI 占位:
- Tab: 黑名单 / 异常阈值 / IP 限制 / 退款监控 / 第三方
- 每 Tab 一组配置表单 + 启停开关

### 11.5 风险用户 (`/risk-users`) 🟡 占位

风控规则触发后的"被标记用户"列表(用户运营视角):
- StatCardGroup: 黑名单 / 异常用量 / 反欺诈命中 / 已封禁
- DataTable: 用户 / 标记类型 / 触发规则 / 触发时间 / 严重度 / 操作(解封/拉黑/查看详情)

---

## 12. 用户运营扩展

### 12.1 用户列表 (`/users`)

v1 已重设计,无变更。

### 12.2 用户详情 (`/users/:id`)

v1 已完成(三种产品卡 + 5 Tab)。v2 加 1 个新 Tab:
- **风险**: 风险标记历史 / 当前命中规则 / IP 历史 / 设备指纹

### 12.3 用户分群 (`/user-segments`) 🟡 占位

后端 schema:
```prisma
model UserSegment {
  id           String
  name         String      // "VIP" / "学生" / "企业" / "免费用户"
  description  String
  ruleType     String      // STATIC(手动)/ DYNAMIC(规则)
  ruleExpr     String?     // JSON 规则: {"monthSpentCents":{"$gt":100000}}
  memberCount  Int                          // 缓存
  isActive     Boolean
}
model UserSegmentMember {
  id           String
  segmentId    String
  userId       String
  joinedAt     DateTime
}
```

UI 占位:
- 分群列表(StatCard:分群数 / 总用户覆盖 / 动态分群占比)
- 详情: 规则编辑器 + 当前成员预览 + 用法(被哪些规则引用:CreditGrantRule / Campaign / DiscountCode)

### 12.4 工单中心 (`/tickets`) 🟡 占位

客服工单系统占位。后端 schema:
```prisma
model Ticket {
  id           String
  userId       String
  subject      String
  category     String       // BILLING / TECHNICAL / REFUND / FEATURE / OTHER
  priority     String       // URGENT / HIGH / NORMAL / LOW
  status       String       // OPEN / IN_PROGRESS / RESOLVED / CLOSED
  assigneeId   String?
  createdAt
  resolvedAt   DateTime?
}
model TicketMessage {
  id           String
  ticketId     String
  authorType   String       // USER / ADMIN
  authorId     String
  content      String
  attachments  String       // JSON
}
```

UI 占位:
- 工单列表(StatCardGroup:未处理 / 处理中 / 24h 内 SLA 风险 / 已解决)
- 详情页(对话流 + 用户上下文侧边栏)

---

## 13. 数据迁移与兼容性

### 13.1 后端 schema 前置任务清单

按优先级排:

**P0(阻塞 v2 部分功能)**:
- 无(v2 都是占位 + 前端,后端可滞后)

**P1(占位页投产前需做)**:
1. `CreditGrantRule` 表 + cron + 过期消费 → 解锁 `/grant-rules`
2. `UserSegment` + `UserSegmentMember` 表 → 解锁 `/user-segments`
3. `RechargeTier` 表 → 解锁 `/recharge-tiers`
4. `ModelPricing` 加 14 个字段 → 解锁模型库展示
5. `RiskRule` + `RiskList` 表 → 解锁 `/risk-rules` 和 `/risk-users`

**P2**:
6. `Ticket` + `TicketMessage` 表 → 解锁 `/tickets`
7. `ReferralProgram` + `ReferralRedemption` 表 → 解锁 `/referrals`
8. UserBalance 加 `creditLimit` 字段 → 解锁 `/credit-policy`
9. UserSubscription 加状态机字段 → 解锁 `/subscriptions`

### 13.2 v2 前端实施策略

每个占位页 UI 的"准备程度":
- **空状态 + 运营文案**: 解释这个功能能干什么,即使没数据也让运营理解
- **TODO 表单**: 字段都画出来(ant Form),提交时禁用 + tooltip 说明"待后端就绪"
- **占位列表**: 显示 mock 几条样例数据,标记 "示例数据"

---

## 14. 共用组件复用

v1 已建的 6 个共用组件 (Tag / PageHeader / StatCard / FilterBar / DataTable / DetailDrawer)
完全复用,v2 不引入新通用组件。

可能需要的 v2 专用组件 (放在各页面本地,不进 common):
- `MetricChart` — 趋势图封装(recharts AreaChart 默认配置)
- `FunnelChart` — 漏斗图(recharts FunnelChart)
- `EmptyPlaceholder` — 占位页空状态(描述 + TODO 列表)

---

## 15. 测试与发布策略

### 15.1 测试覆盖

- 占位页: 渲染测试(空状态正确 / 操作按钮 disabled)
- 真做页: 与 v1 一致的覆盖率门槛(组件 ≥95% / 页面 ≥85%)
- 路由 redirect: E2E 测试旧路径 → 新路径

### 15.2 发布顺序

1. 一次性合并(v2 IA 重排 + 占位页 + 真做的 5 个) → newsaas 分支
2. 部署 saas-test 验证视觉 + 路由 + 现有功能不回归
3. 后端按 P1 顺序推前置任务,每完成一项,admin 端切换占位为真实 UI
4. saas-prod 上线时机由产品决定

### 15.3 回滚

v2 是纯前端改动,出问题直接 revert commit 即可。后端 schema 改动作为独立后端 PR,与
admin 端解耦发布。

---

## 16. 决策记录(v2 增量)

| 决策 | 结论 | 理由 |
|---|---|---|
| 一级菜单数 | 9 (v1 是 7) | 业务运营复杂度提升,9 块刚好,每块边界清晰 |
| 产品中心是否保留 | 不保留(拆解) | 用户反馈"东一块西一块",订阅/按量必须独立 |
| 加油包归属 | 订阅运营 | 仅 SUBSCRIPTION 模式有意义 |
| 充值面额归属 | 按量运营 | 按量产品才需要 |
| 营销是否独立菜单 | 独立 | 跨模式共享,不应嵌套在订阅或按量里 |
| 风控分两层 | 是 | 用户层(被标记)+规则层(配置)分开,职责清晰 |
| /usage /revenue 处理 | 删除并重定向到 /finance-reports | 后者是前者的超集 |
| Dashboard 双维度 | 订阅区 + 按量区 + 共享区 | 用户明确要求 |
| ModelPricing 升级 | 升级为模型库,补 14 字段 | 用户给出 OpenRouter 截图作为参考 |
| 占位页数量 | 13 | 真做的 5 个 + 占位 13 = 28 路由 |
| 风控接入 | 用户回复明确要 | 黑名单/异常/IP/退款率/反欺诈 5 维度 |
| A/B / Affiliate / BYOK 等 | 砍掉 | 自研成本高 / 业务规模未到 / 第二批 |

---

## 17. 与 v1 的明确变更清单

**v1 落地保留(不动)**:
- stsoft V1 设计 token + 6 共用组件
- AdminLayout 240px Sider + 顶部产品筛选器
- 5 个样板页(Dashboard / Users / UserDetail / Channels / Orders)
- 权限映射机制 LEGACY_PERMISSION_MAP
- vitest + RTL 测试栈

**v2 改动**:
- AdminLayout 菜单结构: 7 一级 → 9 一级
- Dashboard: 4 卡 + 4 panel → 5 卡 + 双维度区
- PlanDetail: 6 卡 → 6 Tab
- ModelPricing → 模型库升级(暂等后端)
- 财务: /usage /revenue → /finance-reports
- 新增 13 个占位页
- 新增 5 个新真做页(/booster-packs 独立 / /campaigns + /discount-codes 移营销 / /finance-reports 接管 + 一些路由调整)

---

## 18. 参考

- v1 spec: `docs/superpowers/specs/2026-04-27-admin-redesign-design.md`
- v1 plan: `docs/superpowers/plans/2026-04-27-admin-redesign.md`
- v1 migration: `apps/admin/MIGRATION.md`
- 用户截图: OpenRouter 模型市场风格(2026-04-28 提供)
- 现有 schema: `apps/api/prisma/schema.prisma`

---

## 19. 23 页详细设计（v1 已做的 5 页除外）

每页设计模板：路由 + 权限 / PageHeader / StatCardGroup / FilterBar / DataTable / 详情 / Schema / API。

### 19.1 用户分群 `/user-segments`

- 权限: `users.segments.manage`
- 业务目的: 定义用户标签 + 自动规则,被 CreditGrantRule / Campaign / DiscountCode 引用为"适用人群"
- PageHeader: 标题"用户分群" + 副标题 + [+ 新建分群]
- StatCardGroup (4): 分群总数 / 静态分群 / 动态分群 / 总用户覆盖(去重)
- FilterBar: 搜索 / 分群类型 / 状态
- DataTable: 分群名 + 描述 / 类型 Tag / 成员数 / 引用次数 / 时间 / 状态 / 操作[详情/复制/启停/删除]
- 独立详情页 4 Tab:
  1. **基本信息**: name / description / 类型切换
  2. **规则配置**: 静态(批量导入CSV+手动添加用户) | 动态(可视化规则编辑器: 字段+操作符+值, AND/OR 组合, 实时预览匹配数)
  3. **当前成员**: 分页列表(5000 上限)
  4. **被引用**: 哪些 Campaign/CreditGrantRule/DiscountCode 引用了此分群
- Schema: `UserSegment` + `UserSegmentMember`(见 §12.3)
- API: CRUD + `POST /preview`(预览规则) + `POST /:id/refresh`(重算成员)

### 19.2 工单中心 `/tickets`

- 权限: `users.tickets.manage`
- 业务目的: 客服工单系统,与财务对账时常用作"另一半证据"
- PageHeader: [导出] [+ 新建工单]
- StatCardGroup (5): 未处理 / 处理中 / 24h SLA 风险 / 今日新增 / 平均响应时间
- FilterBar: 搜索 / 分类 / 优先级 / 状态 / 处理人 / 时间
- DataTable: 工单号(TKT-YYYYMMDD-NNNNN) / 标题+用户 / 分类 Tag / 优先级 Tag / 状态 Tag / 处理人 / 创建+最近回复(相对时间) / 操作
- 独立详情页:
  - 左 60% 对话流(用户/管理员消息气泡 + 时间 + 附件)
  - 右 40% 用户上下文 StatCard 组(基本信息 / 当前订阅 / 累计消费 / 最近 5 单)
  - 顶部操作栏(分类/优先级/状态/处理人切换 + 合并工单 + 关闭工单)
  - 底部回复编辑器(富文本 + 附件 + 内部备注/回复用户)
- Schema: `Ticket` + `TicketMessage`(见 §12.4)

### 19.3 风险用户 `/risk-users`

- 权限: `users.risk.manage`
- 业务目的: 被风控规则触发的用户列表(运营操作入口)
- PageHeader: [导出] [批量解封]
- StatCardGroup (5): 黑名单 / 异常用量 / 反欺诈命中 / 已封禁 / 待审核
- FilterBar: 搜索 / 风险类型 / 严重度 / 状态 / 触发时间
- DataTable: 用户(邮箱+ID)/ 风险类型 Tag / 触发规则(链接 risk-rules)/ 严重度 dot+文字 / 触发次数 / 触发时间 / 当前状态 / 操作[查看/确认/解封/永久拉黑]
- Drawer 详情 4 Tab: 基本信息 / 触发历史(时间线)/ 关联用户(同 IP/同设备指纹)/ 操作记录
- Schema: `RiskFlag`(见 §11.5)

### 19.4 套餐管理 `/plans` (列表)

- 权限: `products.plans.view/manage`
- PageHeader: [+ 新建套餐]
- StatCardGroup (4): 套餐总数 / 活跃订阅最多套餐 / 30天新订阅 / 收入 Top
- FilterBar: 搜索 / 产品 / 计费类型(individual/team/enterprise)/ 状态(active/legacy/inactive)
- DataTable: 套餐名+产品+planType / 月费 / 年费 / 月度积分 / 活跃订阅数(链接)/ 试用天数 / 状态 / 操作[详情/复制/上下架/标记 legacy]

### 19.5 套餐详情 `/plans/:id` — **6 Tab 重组**

- PageHeader 面包屑: 套餐管理/{套餐名} + actions[复制/上下架/删除]
- 底部固定栏: [取消] [保存](所有 Tab 共用一个 Form)

**Tab 1 概览**
- name / description / productId / planType(individual/team/enterprise)/ billingPeriod(monthly/yearly/quarterly)/ monthlyPrice / yearlyPrice / monthlyCredits / creditsRollover(开关)/ rolloverMaxMonths / badge / sortOrder / isActive

**Tab 2 价格**
- 多币种 PlanPrice CRUD(currency 选项 USD/CNY/EUR/SGD/JPY / monthlyPrice / yearlyPrice / 启停)
- DataTable: 币种 / 月付 / 年付 / 状态 / 操作 + [+ 新增币种]
- 试用配置: trialDays / 试用结束策略(自动转付/转免费版/暂停)

**Tab 3 模型**
- 模型组配置(ModelAccess 关联)
- DataTable: 模型名 / Provider / 输入价 / 输出价 / 倍率(可编辑)/ 启用开关
- 操作: [+ 添加模型] [批量启停] [按 provider 全选]

**Tab 4 配额**(仅 CodingPlan 类型显示)
- PlanQuotaRule 多条规则编辑器: windowType(ROLLING/FIXED_PERIOD/CUMULATIVE)/ durationLabel+durationSec / metric(REQUESTS/INPUT_TOKENS/OUTPUT_TOKENS/TOTAL_TOKENS/CREDITS)/ limitValue / modelGroup
- 速率限制: rateLimitRpm / rateLimitTpm / maxContextWindow

**Tab 5 团队**
- memberLimit / minimumSeats / 共享配额规则(多席位是否共用月度积分)/ 邀请权限(owner only / admin / all members)

**Tab 6 高级**
- overageEnabled / usageMultiplier / 自动续费规则(默认开启/提前 N 天扣款)/ 退款策略(按比例/按未消费/不可退)/ dataTraining(opt_in/opt_out/never)/ supportTier / ssoEnabled / priorityAccess

### 19.6 加油包 `/booster-packs`

- 权限: `products.plans.manage`
- PageHeader: [+ 新建加油包]
- StatCardGroup (4): 加油包总数 / 总销售额 / 30天销售数 / Top 销售款
- FilterBar: 搜索 / 产品 / 状态
- DataTable: 名称 / 适用产品 / 积分数 / 售价 / 有效期(天)/ 销售总数 / 状态 / 操作
- 详情 Drawer: name / productId / credits / priceCents / validityDays / description / sortOrder / isActive

### 19.7 配额规则 `/quota-rules`

- 权限: `products.subscriptions.quota.manage`
- 业务目的: CodingPlan 套餐的配额模板库(可在 PlanDetail Tab 4 引用)
- PageHeader: [+ 新建模板]
- StatCardGroup (3): 模板数 / 引用最多模板 / 平均被引用数
- DataTable: 模板名 / 描述 / 规则数 / 被引用 plan 数 / 创建时间 / 操作
- 详情: 模板名 + N 条规则编辑器(同 §19.5 Tab 4)
- Schema: 新表 `PlanQuotaTemplate`,PlanQuotaRule 加 `templateId` 可选字段

### 19.8 订阅生命周期 `/subscriptions`

- 权限: `products.subscriptions.lifecycle.manage`
- 业务目的: 订阅运营人员的全局看板,专注续订/挽回
- PageHeader: [导出] [批量发券]
- StatCardGroup (5): 活跃订阅 / 7 天内到期 / 已退订未挽回(30天)/ 续费成功率 / 自动续费失败
- 4 Tab:
  1. **即将到期**: expiresAt < now+7d,列: 用户/套餐/到期日/已发提醒次数/操作[发提醒券/手动续费]
  2. **已退订**: cancelledAt 内 30 天,列: 用户/原套餐/退订时间/退订原因/操作[发挽回券/打电话]
  3. **续费失败**: 自动续费扣款失败,列: 用户/套餐/失败时间/失败原因/重试次数/操作[手动重试]
  4. **降级保留**: 从高档降到低档但未流失,列: 用户/原套餐→新套餐/降级时间
- Schema: UserSubscription 加: autoRenew / nextBillingAt / cancellationReason / winbackOffered / lastRenewalFailedAt

### 19.9 充值面额 `/recharge-tiers`

- 权限: `products.payg.tiers.manage`
- PageHeader: [+ 新建面额]
- StatCardGroup (3): 面额总数 / 30 天总充值额 / Top 销售面额
- DataTable: 面额(¥100/¥500/¥2000)/ 适用产品 / 赠送(fixed +¥10 / percent +20%)/ 销售次数 / Badge / 启停 / 操作[详情/复制/排序]
- 详情 Drawer: productId / amountCents / bonusType(FIXED/PERCENT)/ bonusValue / badge / sortOrder / isActive / startAt / endAt
- Schema: `RechargeTier`(见 §7.1)

### 19.10 信用额度 `/credit-policy`

- 权限: `products.payg.policy.manage`
- 业务目的: 按量产品的"先用后付"配置 + 欠费用户管理
- 上半页全局策略 Card: 是否允许欠费 / 默认信用额度 / 欠费上限触发动作(暂停/告警/邮件)/ 自动恢复条件(充值即恢复/7 天后/不自动)
- 中段用户级覆盖 Card: 分群 → 信用额度(VIP ¥1000 / 企业 ¥10000)
- 下半页欠费用户列表(balanceCents < 0): 用户 / 当前余额 / 欠费时长 / 欠费原因 / 信用额度 / 操作[充值催收/暂停/拉黑]
- Schema: UserBalance 加 `creditLimit Int @default(0)`,新表 `CreditPolicyConfig`

### 19.11 限时活动 `/campaigns`

- 复用现有页面 + 套规范
- PageHeader / StatCardGroup(活动数/进行中/累计兑换/总让利)/ FilterBar / DataTable
- DataTable: 活动名 / 适用 plan / 折扣 / 时间区间 / 兑换数 / 状态 / 操作

### 19.12 促销码 `/discount-codes`

- 复用现有 + 套规范
- PageHeader: [+ 新建] [批量生成]
- StatCardGroup (4): 券总数 / 已发放 / 已兑换 / 兑换率
- DataTable: 券码 / 适用 plan / 折扣 / 兑换次数限制 / 已兑换 / 失效时间 / 状态 / 操作

### 19.13 定时奖励 `/grant-rules` — **运营核心需求**

- 权限: `marketing.grants.manage`
- PageHeader: [+ 新建规则] [模拟运行]
- StatCardGroup (4): 规则总数 / 今日已发放 / 30 天发放总额 / 受益用户数
- FilterBar: 搜索 / 触发类型 / 适用分群 / 状态
- DataTable: 规则名 / 触发方式(DAILY_CRON 0:00 / FIRST_LOGIN / DAILY_CHECKIN)/ 奖励(300 积分,当天过期)/ 适用分群 / 启停 / 操作[详情/复制/手动触发/查看记录]
- 独立详情页 3 Tab:
  1. **规则配置**: name / triggerType / cronExpr / segmentId(联动 user-segments)/ rewardType / rewardAmount / productId / expirePolicy / expireDays / perUserLimit / globalDailyCap / startAt / endAt / notifyType / notifyTemplate
  2. **预览**: 当前匹配用户数 / 预计今日发放总额 / 模拟触发按钮
  3. **发放记录**: 用户/时间/数额/是否已用完/是否已过期
- Schema: `CreditGrantRule` + CreditTransaction 字段扩展(见 §8.3)

### 19.14 邀请裂变 `/referrals`

- 权限: `marketing.referrals.manage`
- PageHeader: [+ 新建程序]
- StatCardGroup (5): 活跃程序 / 总邀请人 / 总被邀请人 / 转化率 / 累计奖励发放
- 3 Tab:
  1. **程序列表**: 程序名/邀请人奖励/被邀请人奖励/触发条件(注册/首充/订阅)/启用/累计兑换数
  2. **兑换记录**: 邀请人/被邀请人/触发时间/奖励状态
  3. **排行榜**: 邀请人 Top 50(防作弊: 同 IP/同设备过滤)
- 详情: name / inviterReward / inviteeReward / rewardCondition(REGISTER/FIRST_RECHARGE/FIRST_SUBSCRIBE)/ 双方奖励产品 / 防作弊规则(同 IP 限制/同设备限制/邀请数上限)/ startAt / endAt
- Schema: `ReferralProgram` + `ReferralRedemption`(见 §8.4)

### 19.15 模型库 `/models` — **升级 ModelPricing**

- 权限: `ops.pricing.manage`
- PageHeader: [+ 新建模型] [批量上下架] [批量更新定价] [获取最新报价]
- StatCardGroup (5): 模型总数 / 已上架 / 30 天调用 token / Top 收入模型 / 异常模型(缺定价/孤儿)
- FilterBar: 搜索 / Provider / 输入类型 / 输出类型 / 上下文档位(16k/128k/1M)/ 上架状态 / 标签
- DataTable: Logo+名称+ModelID(mono)/ 输入输出类型图标 / 上下文 / 输入价 / 输出价 / 月调用 token / 上架 Switch / 操作
- 详情独立页 6 Tab:
  1. **基本信息**: name / provider / modelId / description(markdown 编辑)/ tags(多选)
  2. **能力**: inputModalities / outputModalities / contextLength / maxOutputTokens / supportedFeatures(function_call/streaming/caching/vision/...)
  3. **定价**: inputPriceCents / outputPriceCents / cachedInputPrice / batchDiscount
  4. **上架**: isPublished / displayOrder / releaseAt / providerLogo URL
  5. **用量**: 30 天调用趋势 / Top 10 用户 / Top 10 渠道
  6. **关联**: 哪些 plan 包含此模型 / 哪些 channel 提供此模型
- Schema: ModelPricing 14 字段扩展(见 §9.1)

### 19.16 ApiKey 管理 `/api-keys`

- 权限: `ops.apikeys.manage`
- PageHeader: [导出] [批量吊销异常 Key]
- StatCardGroup (5): Key 总数 / 活跃(30 天有调用)/ 异常告警 / 月用量 Top 10 总和 / 30 天新建数
- FilterBar: 搜索 prefix / 用户 / 产品 / 状态 / 创建时间
- DataTable: prefix(mono 部分模糊)/ 用户邮箱 / 产品 / 创建时间 / 最近使用 / 月调用次数 / 月用量 / 状态 / 操作[详情/启停/删除]
- 详情 Drawer 3 Tab: 基本信息 / 用量(30 天 token 趋势 + 按模型分布 + 按渠道分布)/ 异常(被风控触发记录 + 被限流次数)

### 19.17 财务报表 `/finance-reports`

- 复用现有 8 Tab(月度对账汇总/收入订单/收款渠道/余额/积分/API用量/供应商/字段缺口)
- v2 增量: PageHeader 加产品筛选器联动 + FilterBar 加全局月份选择器

### 19.18 支付配置 `/payment-config`

- 权限: `finance.payment.manage`
- 三组 Card 各自独立保存按钮:
  - **Stripe**: 开关 / publishable key / secret key(脱敏)/ webhook secret / [测试连接]
  - **微信支付**: 开关 / appId / mchId / serialNo / 私钥(脱敏)/ 公钥 / 回调 URL
  - **支付宝**: 开关 / appId / 私钥 / 公钥 / 回调 URL
- 底部 **支付方式启停矩阵**: 行=支付方式,列=产品,复选框

### 19.19 实时监控 `/monitoring`

- 权限: `audit.monitoring.read`
- PageHeader 副标题"近 1 小时实时数据,30 秒自动刷新"
- StatCardGroup (5): 在线用户 / QPS / P95 延迟 / 错误率 / Token 流量
- 主体三栏: 实时请求流(StreamList 自动滚动) / 当前会话列表 / 渠道实时健康度 dot 矩阵

### 19.20 告警中心 `/alerts`

- 权限: `audit.alerts.manage`
- PageHeader: [标记全部已读] [批量处理]
- StatCardGroup (5): 未处理 / 严重 / 24h 内新增 / 平均处理时长 / 重复发生次数 Top 1
- FilterBar: 搜索 / 类型 / 严重度 / 状态 / 主体 / 时间
- DataTable: 时间 / 类型(PAYMENT/CHANNEL/USAGE/SECURITY/SYSTEM)/ 主体 / 严重度 dot+文字 / 状态 / 处理人 / 操作[查看/标记处理/创建工单/添加为风控规则]
- 详情 Drawer 3 Tab: 基本信息(发生时间/类型/严重度/触发规则/详细 context JSON)/ 历史(同类告警 7 天)/ 操作(处理动作+备注)
- Schema: 复用 Alert 表 + 加 category/severity/handledAt/handledBy/handledNote 字段

### 19.21 业务漏斗 `/funnel`

- 权限: `audit.funnel.read`
- PageHeader 时间区间选择器: 近 7/30/90 天
- 主漏斗图: 注册→邮箱验证→首次登录→首次调用→首次付费→二次付费→月活→续订
  - 每步显示: 人数/转化率/与上周期对比
- 下半区分群分析: 选用户分群(联动 user-segments)→ 看该群体的漏斗
- 下半区订阅 vs 按量 双漏斗对比
- API: 客户端聚合,标 TODO 待后端聚合接口

### 19.22 风控规则 `/risk-rules`

- 权限: `audit.risk.manage`
- 5 Tab:
  1. **黑名单**: 列表(type/value/reason/addedBy/expiresAt)+ [+ 添加] [批量导入 CSV]
  2. **异常用量**: 阈值配置(单日 token > X / 单日扣费 > Y / 模型调用 > N)+ 触发动作(停 Key/告警)
  3. **同 IP 多账号**: 阈值(同 IP > N 个账号 7 天内)+ 动作
  4. **退款监控**: 全局退款率阈值 + 单产品退款率阈值 + 触发动作(暂停产品/告警)
  5. **第三方反欺诈**: FingerprintJS / reCAPTCHA / 自定义 webhook 接入配置
- 每条规则: name / 触发条件 / 动作 / 启停 / 触发计数 / 最近触发时间 / 操作
- Schema: `RiskRule` + `RiskList`(见 §11.4)

### 19.23 审计日志 `/audit-logs`

- 权限: `audit.logs.read`
- 复用现有 + 套规范
- FilterBar: 搜索 / 操作类型 / 操作员 / 主体类型 / 时间
- DataTable: 时间 / 操作员 / 操作类型 / 主体(user/order/plan/...)/ 主体 ID / IP / 详情
- Drawer: 完整 JSON diff(before/after)

### 19.24 公告 `/announcements`

- 权限: `audit.announcements.manage`
- PageHeader: [+ 发布公告]
- StatCardGroup (4): 当前生效 / 已过期 / 30 天点击 / 阅读率
- DataTable: 标题 / 类型(重要/普通/活动)/ 受众(全员/分群)/ 生效区间 / 阅读数 / 状态 / 操作
- 详情: title / content(markdown)/ type / segmentId / startAt / endAt / 推送方式(站内信/邮件/弹窗)

### 19.25 角色权限 `/team`

- 权限: `system.team.manage`
- PageHeader: [+ 新建角色]
- StatCardGroup (3): 角色数 / 用户最多角色 / 自定义角色数
- DataTable: 角色名 / 描述 / 关键(super_admin/admin/operator/finance/viewer)/ 用户数 / 权限数 / 操作
- 详情: 角色 name / description / 权限矩阵(按域分组的复选框)

### 19.26 后台账号 `/members`

- 权限: `system.team.manage`
- PageHeader: [+ 邀请成员]
- StatCardGroup (4): 管理员总数 / 启用 / 禁用 / 30 天活跃
- FilterBar: 搜索 / 角色 / 状态
- DataTable: 邮箱 / 昵称 / 角色 / 自定义权限标记 / 最近登录 / 状态 / 操作[编辑角色/重置密码/启停/移除]
- 邀请 Modal: email / nickname / presetRole 选择器 / 自定义权限覆盖(开关 + 权限点列表)

### 19.27 功能开关 `/feature-flags`

- 权限: `system.flags.manage`
- DataTable: key / 描述 / 当前值 / 类型(boolean/percent/segment)/ 命中规则 / 状态 / 操作
- 详情: key / description / type / value / targetSegments / rolloutPercent

### 19.28 系统提示词 `/system-prompts`

- 权限: `system.prompts.manage`
- DataTable: name / 描述 / 适用模型 / 版本 / 状态 / 操作
- 详情: name / content(markdown 编辑器,monospace)/ 适用模型组 / 版本号 / 上下架

### 19.29 系统设置 `/system-config`

- 权限: `system.config.manage`
- 分 Card 组织,每 Card 独立保存按钮:
  - **基础信息**: 站点名 / Logo / 主题色 / favicon
  - **邮件**: SMTP / 模板配置
  - **OAuth**: Auth0 / 微信 / GitHub 配置
  - **API 网关**: 超时 / 限流默认值 / 重试策略
  - **存储**: S3 / OSS 配置
  - **日志**: 保留天数 / 等级
  - **维护模式**: 开关 + 公告文案

---

## End of Spec v2
