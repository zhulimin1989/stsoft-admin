# Admin v2 后端 P1 实施 · Design Spec

- **Date**: 2026-04-30
- **Scope**: codesphere-admin-saas / apps/api(后端) + apps/admin(前端接入)
- **Owner**: 后端业务能力补全
- **Status**: Approved
- **Predecessor**: v2 admin 已部署到 saas-test (`5bddc90`,占位页 + EmptyPlaceholder)
- **Next**: writing-plans 生成实施 plan

---

## 1. 背景与目标

### 1.1 现状

v2 admin 重设计已部署到 saas-test。13 个新页面 UI 完整,但**后端 schema 和 API 还没建**——
打开页面会调 `/admin/v2/*` endpoint,后端返回 404,前端 fallback 到 `EmptyPlaceholder` 显示
"功能开发中"。

### 1.2 目标

按 v2 spec §13.1 列出的 P1 优先级,把 7 个核心后端能力**完整实现**:

| # | 能力 | admin 占位页 | 实现完成后 |
|---|---|---|---|
| 1 | UserSegment | `/user-segments`(列表+详情) | 用户分群可创建/编辑/查看成员/被引用反查 |
| 2 | PlanQuotaTemplate | `/quota-rules` | 配额规则模板可建/编辑,PlanDetail 配额 Tab 可引用 |
| 3 | RechargeTier | `/recharge-tiers` | 按量产品的充值面额可建/上下架/限时 |
| 4 | ModelPricing 14 字段扩展 | `/models`(模型库) | 模型库展示介绍/能力/上下文/Provider Logo 等 |
| 5 | CreditGrantRule | `/grant-rules`(列表+详情) | 定时奖励规则(每日 N 积分当天过期等)能配/能跑 |
| 6 | RiskRule + RiskList + RiskFlag | `/risk-rules`(5 Tab) + `/risk-users` | 风控规则可配/触发引擎可跑/风险用户列表可见 |
| 7 | Ticket + TicketMessage | `/tickets`(列表+详情) | 客服工单系统(对话流 + 用户上下文 + SLA) |

### 1.3 完成度标准

每个能力按 **v2 spec §19 详设全实现**,包括:
- 完整 schema 和必需的索引
- 后端 Service / Controller / API 全套
- admin 前端从占位 UI 切到真实数据
- 必要的 BullMQ Job(定时任务)
- 单元测试覆盖核心路径

### 1.4 非目标(本次不做)

- ❌ 修改现有业务逻辑(订阅/订单/支付/Stripe 集成全部不动)
- ❌ 用户端 Web 改造(那是另一个开发窗口的事)
- ❌ 企业组织(Organization/Team)能力 — 等用户端组织功能成熟后再说
- ❌ Auth0 / JWT / 鉴权流程改动
- ❌ 多租户 / Tenant 化改造

### 1.5 PR 策略

7 个独立 PR,每个 PR 完成后单独合 newsaas + 部署 saas-test 验证。
PR 间相互独立(schema 不互相直接依赖,除 grant-rules 引用 user-segments 外都独立)。
某个 PR 出问题不影响其他能力运转。

**PR 顺序**(按依赖):

```
PR1  UserSegment(含静态成员 + 8 字段动态规则引擎)
   ↓
PR2  PlanQuotaTemplate(配额规则模板库)
   ↓
PR3  RechargeTier(充值面额配置)
   ↓
PR4  ModelPricing 14 字段扩展(模型库)
   ↓
PR5  CreditGrantRule(依赖 PR1 的 segmentId)+ BullMQ credit-grant + credit-expire job
   ↓
PR6  RiskRule + RiskList + RiskFlag(三件套)+ BullMQ risk-engine job
   ↓
PR7  Ticket + TicketMessage + BullMQ ticket-sla job
```

### 1.6 红线

- 不动现有业务表的现有字段(只能增加 nullable 字段或新表)
- 现有 admin/user/billing/payment service 不修改业务逻辑
- 现有 API endpoint 不破坏(`/admin/users` `/admin/orders` 等照常)
- 数据库 migration 必须可向后回退

---

## 2. 架构总览

### 2.1 后端模块布局

```
apps/api/src/
├─ user-segments/         # PR1 — 用户分群
│   ├─ user-segments.module.ts
│   ├─ user-segments.controller.ts   # /admin/v2/user-segments
│   ├─ user-segments.service.ts
│   ├─ segment-rule-engine.ts        # JSON 规则解析 → Prisma where
│   └─ user-segments.spec.ts
├─ quota-templates/       # PR2
├─ recharge-tiers/        # PR3
├─ model-catalog/         # PR4 (扩展现有 modelPricing)
├─ credit-grants/         # PR5
│   ├─ credit-grants.controller.ts   # /admin/v2/grant-rules
│   ├─ credit-grants.service.ts
│   ├─ credit-grant-executor.ts      # 执行单条规则的逻辑
│   ├─ credit-expire.service.ts      # 过期消费 + 反向流水
│   └─ jobs/
│       ├─ credit-grant.job.ts       # BullMQ Repeatable: 每日 0 点
│       └─ credit-expire.job.ts      # BullMQ Repeatable: 每日 0:30
├─ risk/                  # PR6
│   ├─ risk.module.ts
│   ├─ risk-rules.controller.ts      # /admin/v2/risk-rules
│   ├─ risk-flags.controller.ts      # /admin/v2/risk-users
│   ├─ risk-rules.service.ts
│   ├─ risk-engine.service.ts        # 实时检查 + 定时扫描
│   └─ jobs/
│       └─ risk-engine.job.ts        # BullMQ Repeatable: 每 5 分钟
├─ tickets/               # PR7
│   ├─ tickets.controller.ts
│   ├─ tickets.service.ts
│   └─ jobs/
│       └─ ticket-sla.job.ts         # BullMQ Repeatable: 每 30 分钟
└─ jobs/                  # 通用 BullMQ 基础设施(若不存在则建)
    └─ jobs.module.ts
```

### 2.2 前端接入(apps/admin)

每个 PR 把对应占位页的 stubMode 兜底逻辑去掉,接入真实 API:

```
apps/admin/src/api/v2/    # v2 API 客户端 stub(已存)
                          # 接入时把每个文件的 endpoint 调用接到真实后端
apps/admin/src/pages/     # 占位页 → 接入真实数据
  UserSegments/           # PR1
  QuotaTemplates/         # PR2
  RechargeTiers/          # PR3
  Models/                 # PR4(已是模型库,补字段渲染)
  GrantRules/             # PR5
  RiskRules/              # PR6
  RiskUsers/              # PR6
  Tickets/                # PR7
```

### 2.3 BullMQ 基础设施

复用现有 BullMQ(webhook 重试已用)。新增 6 个队列:
- `credit-grant`(每日 0 点)
- `credit-expire`(每日 0:30)
- `segment-refresh`(每小时 0 分)
- `risk-engine`(每 5 分钟)
- `ticket-sla`(每 30 分钟)
- `monthly-reset`(每月 1 号 0:00)

每个队列有 Repeatable Job + 单点 worker(Redis 锁保证多实例不重复执行)。

### 2.4 数据库 Migration 策略

每个 PR 一个独立 migration 文件,只动自己的表:
- PR1: `20260501000001_user_segments.sql` — 建 UserSegment + UserSegmentMember
- PR2: `20260502000001_plan_quota_templates.sql` — 建 PlanQuotaTemplate
- PR3: `20260503000001_recharge_tiers.sql` — 建 RechargeTier
- PR4: `20260504000001_model_pricing_v2_fields.sql` — 现有 ModelPricing 加 14 列
- PR5: `20260505000001_credit_grant_rules.sql` — 建 CreditGrantRule + 给 CreditTransaction 加字段
- PR6: `20260506000001_risk.sql` — 建 RiskRule + RiskList + RiskFlag
- PR7: `20260507000001_tickets.sql` — 建 Ticket + TicketMessage

**所有 migration 必须可回退**(写好 `down` 路径,实测 prisma migrate resolve)。

### 2.5 测试策略

每个 PR 至少:
- 1 个 schema migration 集成测试(数据写入 + 查询无报错)
- 核心 service 单元测试(覆盖 happy path + 关键边界)
- 一个 e2e 测试(API → 数据库 → 返回)

不强制 100% 覆盖率(不现实)。每个 PR 的覆盖率门槛 70% lines。

---

## 3. PR1: UserSegment(用户分群)

### 3.1 Schema

```prisma
model UserSegment {
  id          String   @id @default(uuid())
  name        String
  description String   @default("")
  ruleType    SegmentRuleType
  ruleExpr    String?                 // JSON, 仅 DYNAMIC 用
  memberCount Int      @default(0)    // 缓存,定时刷新
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  deletedAt   DateTime?

  members     UserSegmentMember[]

  @@index([isActive, deletedAt])
  @@map("user_segments")
}

enum SegmentRuleType { STATIC DYNAMIC }

model UserSegmentMember {
  id          String   @id @default(uuid())
  segmentId   String
  userId      String
  joinedAt    DateTime @default(now())

  segment     UserSegment @relation(fields: [segmentId], references: [id], onDelete: Cascade)
  user        User        @relation(fields: [userId], references: [id])

  @@unique([segmentId, userId])
  @@index([segmentId])
  @@index([userId])
  @@map("user_segment_members")
}
```

### 3.2 Rule 表达式格式

```json
{
  "and": [
    { "field": "monthlySpentCents", "op": ">", "value": 100000 },
    { "or": [
      { "field": "subscriptionStatus", "op": "=", "value": "ACTIVE" },
      { "field": "currentBalanceCents", "op": ">", "value": 50000 }
    ]}
  ]
}
```

### 3.3 支持的字段(8 个)

| field | 类型 | 操作符 | Prisma 来源 |
|---|---|---|---|
| `createdAt` | datetime | `>` `<` `between` | User.createdAt |
| `subscriptionStatus` | enum | `=` `in` | UserSubscription.status (ACTIVE/EXPIRED/CANCELLED 或 NONE) |
| `currentPlanId` | string | `=` `in` | UserSubscription.planId |
| `monthlySpentCents` | int | `>` `<` `between` | sum(Order.amountCents WHERE userId=X AND createdAt > now-30d) |
| `currentBalanceCents` | int | `>` `<` | UserBalance.balanceCents |
| `lastActiveAt` | datetime | `>` `<` | TokenUsage 或 ApiKey.lastUsedAt 最大值 |
| `signupChannel` | string | `=` `in` | User.signupChannel(若无字段则跳过此 field) |
| `emailDomain` | string | `=` `contains` | User.email 的 domain 部分 |

### 3.4 Rule Engine

`segment-rule-engine.ts` 把 `ruleExpr` 解析成 Prisma where 条件:

```ts
function parseRule(rule: RuleNode): Prisma.UserWhereInput {
  if ('and' in rule) {
    return { AND: rule.and.map(parseRule) };
  }
  if ('or' in rule) {
    return { OR: rule.or.map(parseRule) };
  }
  // leaf: { field, op, value }
  return parseLeaf(rule);
}

function parseLeaf({ field, op, value }: Leaf): Prisma.UserWhereInput {
  switch (field) {
    case 'createdAt':
      return { createdAt: opToPrisma(op, value) };  // gt/lt/between
    case 'subscriptionStatus':
      return value === 'NONE'
        ? { subscriptions: { none: {} } }
        : { subscriptions: { some: { status: value } } };
    case 'monthlySpentCents':
      // 这种聚合需要 raw query 或 having,在 service 层另外处理
      return { /* 见 §3.5 */ };
    // ... 其他
  }
}
```

聚合字段(monthlySpentCents / lastActiveAt)走两步:
1. 先 raw query 算出符合条件的 userIds
2. 再 `User.findMany({ where: { id: { in: userIds }, ...其他条件 } })`

### 3.5 API

```
GET    /admin/v2/user-segments                   列表
POST   /admin/v2/user-segments                   创建
GET    /admin/v2/user-segments/:id               详情
PUT    /admin/v2/user-segments/:id               更新
DELETE /admin/v2/user-segments/:id               软删
POST   /admin/v2/user-segments/:id/refresh       重算 memberCount
POST   /admin/v2/user-segments/preview           预览规则 → { matchedCount, sampleUserIds[] }
GET    /admin/v2/user-segments/:id/members       当前成员列表
POST   /admin/v2/user-segments/:id/members       静态分群:批量加成员(CSV/userIds)
DELETE /admin/v2/user-segments/:id/members/:uid  静态分群:移除成员
GET    /admin/v2/user-segments/:id/references    被引用反查
```

### 3.6 BullMQ Job

`segment-refresh` 队列每小时跑一次:
```ts
@Process('hourly')
async refreshAll() {
  const segments = await prisma.userSegment.findMany({ where: { isActive: true, ruleType: 'DYNAMIC' } });
  for (const s of segments) {
    const userIds = await this.engine.resolve(s.ruleExpr);
    await prisma.userSegment.update({
      where: { id: s.id },
      data: { memberCount: userIds.length },
    });
  }
}
```

注意:动态分群的 `UserSegmentMember` 表不存 — 每次需要时实时查。`UserSegmentMember` 仅静态分群用。

### 3.7 admin 接入

`/user-segments` 列表页和详情页去掉 stubMode,直接调真实 API:
- 列表 4 个 stat 用 `GET /admin/v2/user-segments` 返回的聚合
- 创建 Modal 接 `POST /admin/v2/user-segments`
- 详情 4 Tab:
  - 基本信息 → `PUT /admin/v2/user-segments/:id`
  - 规则配置 → 静态显示 `GET .../members` + 添加移除接 `POST/DELETE .../members`,动态显示 ruleExpr 编辑器(JSON 输入框 + 预览按钮)
  - 当前成员 → `GET .../members?page&pageSize`
  - 被引用 → `GET .../references` 列出 [grant-rules / campaigns / discount-codes]

---

## 4. PR2: PlanQuotaTemplate(配额规则模板)

### 4.1 Schema

```prisma
model PlanQuotaTemplate {
  id          String   @id @default(uuid())
  name        String   @unique
  description String   @default("")
  rules       String                        // JSON array of QuotaRule
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  deletedAt   DateTime?

  @@index([isActive, deletedAt])
  @@map("plan_quota_templates")
}
```

`rules` JSON 数组每条结构:
```json
{
  "windowType": "ROLLING",       // ROLLING / FIXED_PERIOD / CUMULATIVE
  "durationLabel": "5h",
  "durationSec": 18000,
  "metric": "REQUESTS",          // REQUESTS / INPUT_TOKENS / OUTPUT_TOKENS / TOTAL_TOKENS / CREDITS
  "limitValue": 200,
  "modelGroupId": null
}
```

### 4.2 现有 PlanQuotaRule 表(若已存在则改,若不存在则建)

```prisma
model PlanQuotaRule {
  id            String   @id @default(uuid())
  planId        String
  templateId    String?                       // 新增,引用 template(可选)
  // ... 现有字段
}
```

`PlanDetail.QuotaTab` 编辑套餐配额时,可选"引用模板"(展开显示模板的规则,用户还可微调单条) 或"自定义"(完全不引用)。

### 4.3 API

```
GET    /admin/v2/quota-templates
POST   /admin/v2/quota-templates
GET    /admin/v2/quota-templates/:id
PUT    /admin/v2/quota-templates/:id
DELETE /admin/v2/quota-templates/:id
POST   /admin/v2/quota-templates/:id/clone
GET    /admin/v2/quota-templates/:id/references   返回引用此模板的 plan id 列表
```

### 4.4 admin 接入

`/quota-rules` 列表页直接调真实 API。详情 Modal 编辑 rules(N 条)。

---

## 5. PR3: RechargeTier(充值面额)

### 5.1 Schema

```prisma
model RechargeTier {
  id            String   @id @default(uuid())
  productId     String                          // 关联 Product
  amountCents   Int                             // 充值金额(分)
  bonusType     RechargeBonusType
  bonusValue    Int                             // FIXED: 分; PERCENT: 百分比 0-100
  badge         String?                         // "最受欢迎"
  sortOrder     Int      @default(0)
  isActive      Boolean  @default(true)
  startAt       DateTime?
  endAt         DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  deletedAt     DateTime?

  product       Product  @relation(fields: [productId], references: [id])

  @@index([productId, isActive])
  @@index([startAt, endAt])
  @@map("recharge_tiers")
}

enum RechargeBonusType { FIXED PERCENT }
```

### 5.2 集成到充值流程

用户端发起充值时,后端检查 `RechargeTier` 匹配:
- 若 `amountCents` 等于某 active tier 的 amountCents → 自动应用 bonus
- 自定义金额 → 不应用 bonus

充值订单写入时 metadata 记录 `tierId`(对账用)。

### 5.3 API

```
GET    /admin/v2/recharge-tiers?productId
POST   /admin/v2/recharge-tiers
GET    /admin/v2/recharge-tiers/:id
PUT    /admin/v2/recharge-tiers/:id
DELETE /admin/v2/recharge-tiers/:id
POST   /admin/v2/recharge-tiers/:id/clone
```

### 5.4 admin 接入

`/recharge-tiers` 直接调真实 API。

---

## 6. PR4: ModelPricing 14 字段扩展(模型库)

### 6.1 Schema 扩展现有 ModelPricing

```prisma
model ModelPricing {
  // 现有字段保持
  id, modelName, inputPricePerMToken, outputPricePerMToken, isActive, ...

  // v2 新增 14 字段(都是 nullable,不影响现有数据)
  provider          String?     // openai / anthropic / qwen / ...
  modelId           String?     // "openai/gpt-5.5"
  description       String?     // markdown
  inputModalities   String?     // JSON: ["text","image","file","audio","video"]
  outputModalities  String?
  contextLength     Int?
  maxOutputTokens   Int?
  providerLogo      String?     // URL
  isPublished       Boolean     @default(false)
  displayOrder      Int         @default(0)
  releaseAt         DateTime?
  tags              String?     // JSON array: ["推理","编码"]
  supportedFeatures String?     // JSON array: ["function_call","streaming","caching"]
  cachedInputPrice  Int?        // 缓存命中价 (cents/M token)
  batchDiscount     Float?      // 0-1, batch API 折扣比例

  @@index([provider, isPublished])
  @@index([displayOrder])
}
```

15 个新字段(14 + cachedInputPrice 算 15)。

### 6.2 用户端可见性

- `isPublished = true` → 用户端模型市场页可见
- `isPublished = false` → 仅 admin 后台可见(开发中/废弃模型)

### 6.3 API

`/admin/v2/models` 复用现有 modelPricingApi,增加新字段。
`/v1/models/catalog` 新增端点,返回 isPublished=true 的模型(用户端调)。

### 6.4 admin 接入

`/models` 列表 + 详情按 spec §19.15 渲染所有字段(已是 v2 stubMode,接入真实数据即可)。

---

## 7. PR5: CreditGrantRule(定时奖励)

### 7.1 Schema

```prisma
model CreditGrantRule {
  id              String   @id @default(uuid())
  name            String
  triggerType     GrantTriggerType
  cronExpr        String?                          // DAILY_CRON 时用
  segmentId       String?                          // 引用 UserSegment
  rewardType      GrantRewardType
  rewardAmount    Int                              // 积分数 / 分
  productId       String?
  expirePolicy    GrantExpirePolicy
  expireDays      Int?                             // N_DAYS 时用
  perUserLimit    Int      @default(1)
  globalDailyCap  Int?
  isActive        Boolean  @default(true)
  startAt         DateTime?
  endAt           DateTime?
  notifyType      GrantNotifyType?
  notifyTemplate  String?                          // 站内信/邮件模板 id
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?

  segment         UserSegment? @relation(fields: [segmentId], references: [id])

  @@index([isActive, triggerType])
  @@map("credit_grant_rules")
}

enum GrantTriggerType { DAILY_CRON FIRST_LOGIN DAILY_CHECKIN TASK_COMPLETE WEEKLY_CRON }
enum GrantRewardType { CREDIT BALANCE BOOSTER_PACK }
enum GrantExpirePolicy { PERMANENT SAME_DAY_END N_DAYS NEXT_RESET }
enum GrantNotifyType { INAPP EMAIL SMS NONE }

model GrantRedemption {
  id          String   @id @default(uuid())
  ruleId      String
  userId      String
  amount      Int
  expiresAt   DateTime?
  isExpired   Boolean  @default(false)
  isUsedUp    Boolean  @default(false)
  createdAt   DateTime @default(now())

  rule        CreditGrantRule @relation(fields: [ruleId], references: [id])
  user        User            @relation(fields: [userId], references: [id])

  @@index([ruleId, createdAt])
  @@index([userId, expiresAt])
  @@map("grant_redemptions")
}
```

### 7.2 CreditTransaction 字段扩展

```prisma
model CreditTransaction {
  // 现有字段保持
  // 新增
  expiresAt    DateTime?    // 过期时间(null = 永久)
  grantRuleId  String?      // 来源规则
  isExpired    Boolean      @default(false)

  @@index([userId, expiresAt, isExpired])
}
```

### 7.3 执行逻辑

```ts
// credit-grant-executor.ts
async executeRule(rule: CreditGrantRule) {
  // 1. 找匹配用户(走 segment)
  const userIds = rule.segmentId
    ? await segmentEngine.resolve(rule.segmentId)
    : await prisma.user.findMany({ select: { id: true } }).then(r => r.map(u => u.id));

  // 2. 检查 globalDailyCap
  let granted = 0;

  for (const userId of userIds) {
    if (rule.globalDailyCap && granted >= rule.globalDailyCap) break;

    // 检查 perUserLimit (今天已发几次)
    const todayCount = await this.countTodayRedemptions(rule.id, userId);
    if (todayCount >= rule.perUserLimit) continue;

    // 计算过期时间
    const expiresAt = computeExpiresAt(rule.expirePolicy, rule.expireDays);

    // 发放(transaction)
    await prisma.$transaction([
      prisma.creditTransaction.create({
        data: {
          userId, amount: rule.rewardAmount,
          type: 'GRANT', expiresAt, grantRuleId: rule.id,
        },
      }),
      prisma.grantRedemption.create({
        data: { ruleId: rule.id, userId, amount: rule.rewardAmount, expiresAt },
      }),
    ]);

    granted += rule.rewardAmount;

    // 通知
    if (rule.notifyType !== 'NONE' && rule.notifyTemplate) {
      await notifyService.send(userId, rule.notifyType, rule.notifyTemplate, {
        amount: rule.rewardAmount,
        expiresAt,
      });
    }
  }
}
```

### 7.4 过期消费逻辑(`credit-expire.service`)

每日凌晨 0:30 跑一次:
```ts
// 1. 找所有过期的 CreditTransaction
const expired = await prisma.creditTransaction.findMany({
  where: { expiresAt: { lt: new Date() }, isExpired: false, type: 'GRANT' },
});

// 2. 对每条过期记录:计算用户当前未消费的剩余,减掉这条
for (const tx of expired) {
  // 找该用户该笔的已消费量(可从 GrantRedemption 反查)
  const remaining = tx.amount - (consumedFromThisGrant || 0);
  if (remaining > 0) {
    // 反向流水
    await prisma.creditTransaction.create({
      data: {
        userId: tx.userId,
        amount: -remaining,
        type: 'EXPIRE',
        relatedTxId: tx.id,
      },
    });
  }
  await prisma.creditTransaction.update({
    where: { id: tx.id },
    data: { isExpired: true },
  });
}
```

### 7.5 扣减优先级

用户消费积分时,扣最快过期的:
```ts
// 现有 creditService 改造
async deduct(userId: string, amount: number, reason: string) {
  // 找所有可用余额(未过期 + 未用完),按 expiresAt 升序
  const grants = await prisma.creditTransaction.findMany({
    where: {
      userId, type: 'GRANT', isExpired: false,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { expiresAt: 'asc' },
  });

  // 按顺序扣
  let remaining = amount;
  for (const g of grants) {
    const available = g.amount - (await this.getConsumedFromGrant(g.id));
    if (available <= 0) continue;
    const take = Math.min(remaining, available);
    await prisma.creditTransaction.create({
      data: { userId, amount: -take, type: 'CONSUME', relatedTxId: g.id, reason },
    });
    remaining -= take;
    if (remaining <= 0) return;
  }

  if (remaining > 0) throw new InsufficientCreditError();
}
```

### 7.6 API

```
GET    /admin/v2/grant-rules                     列表
POST   /admin/v2/grant-rules                     创建
GET    /admin/v2/grant-rules/:id                 详情
PUT    /admin/v2/grant-rules/:id                 更新
DELETE /admin/v2/grant-rules/:id                 软删
POST   /admin/v2/grant-rules/:id/preview         预览匹配数 + 预计金额
POST   /admin/v2/grant-rules/:id/manual-trigger  手动触发(立即执行一次)
GET    /admin/v2/grant-rules/:id/redemptions     发放记录列表
```

### 7.7 BullMQ Jobs

- `credit-grant`(每日 0 点)→ 跑所有 `triggerType=DAILY_CRON` 且 isActive 的规则
- `credit-expire`(每日 0:30)→ 标记过期 + 反向流水
- `weekly-grant`(每周一 0 点)→ 跑 `triggerType=WEEKLY_CRON`

`FIRST_LOGIN` / `DAILY_CHECKIN` / `TASK_COMPLETE` 通过事件触发(走 EventEmitter 或直接 service 调用)。

### 7.8 admin 接入

`/grant-rules` 列表 + 详情 3 Tab(规则配置 / 预览 / 发放记录)接入真实 API。

---

## 8. PR6: Risk(风控三件套)

### 8.1 Schema

```prisma
model RiskRule {
  id              String   @id @default(uuid())
  name            String
  ruleType        RiskRuleType
  config          String                          // JSON, 不同 ruleType 结构不同
  action          RiskAction
  isActive        Boolean  @default(true)
  triggerCount    Int      @default(0)
  lastTriggeredAt DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  flags           RiskFlag[]

  @@index([ruleType, isActive])
  @@map("risk_rules")
}

enum RiskRuleType {
  BLACKLIST           // RiskList 关联
  USAGE_THRESHOLD     // 单日 token > X / 单日扣费 > Y
  IP_LIMIT            // 同 IP 多账号
  REFUND_RATE         // 退款率监控
  FRAUD_PROVIDER      // 第三方反欺诈
}

enum RiskAction {
  BLOCK               // 立即拒绝
  ALERT               // 仅告警
  DISABLE_KEY         // 停 Key
  FREEZE_USER         // 冻结用户
}

model RiskList {
  id          String   @id @default(uuid())
  ruleId      String?                             // 可选,关联 BLACKLIST 规则
  listType    RiskListType
  value       String                              // 实际值
  reason      String   @default("")
  addedBy     String                              // adminMemberId
  expiresAt   DateTime?
  createdAt   DateTime @default(now())

  @@unique([listType, value])
  @@index([listType])
  @@map("risk_lists")
}

enum RiskListType { EMAIL DOMAIN IP CARD_HASH USER_ID }

model RiskFlag {
  id              String   @id @default(uuid())
  userId          String
  ruleId          String?
  ruleType        RiskRuleType
  severity        RiskSeverity
  context         String   @default("{}")         // JSON 触发详情
  status          RiskFlagStatus  @default(PENDING)
  triggeredAt     DateTime @default(now())
  resolvedAt      DateTime?
  resolvedBy      String?

  user            User     @relation(fields: [userId], references: [id])
  rule            RiskRule? @relation(fields: [ruleId], references: [id])

  @@index([userId, status])
  @@index([status, triggeredAt])
  @@map("risk_flags")
}

enum RiskSeverity { HIGH MEDIUM LOW }
enum RiskFlagStatus { PENDING CONFIRMED RELEASED PERMANENT_BAN }
```

### 8.2 RiskRule.config 各 ruleType 结构

```json
// BLACKLIST
{ "matchTypes": ["EMAIL", "IP"] }

// USAGE_THRESHOLD
{ "metric": "DAILY_TOKEN", "threshold": 1000000, "windowSec": 86400 }
// metric: DAILY_TOKEN / DAILY_COST / MODEL_CALL_COUNT
// threshold: 阈值

// IP_LIMIT
{ "windowDays": 7, "maxAccountsPerIp": 5 }

// REFUND_RATE
{ "scope": "GLOBAL", "thresholdPct": 10, "windowDays": 30 }
// scope: GLOBAL / PRODUCT / USER

// FRAUD_PROVIDER
{ "provider": "FINGERPRINTJS", "webhookUrl": "...", "apiKey": "***" }
```

### 8.3 风控引擎

**实时检查**(API 调用前):
- BLACKLIST 检查: 用户 email / IP / userId 命中黑名单 → BLOCK
- 缓存键 `risk:blocked:{userId}`,TTL 60s,值为 JSON 信封 `{b,r,t,v,x}` 携带 matched 元数据(命中规则 / 列表类型 / 列表值 / 原因),供命中时审计日志使用;脏值 / 解析失败按 miss 处理。USER_ID 名单条目移除时主动 DEL 该键;IP / EMAIL / DOMAIN / CARD_HASH 类型按 TTL 自然过期。

**定时扫描**(BullMQ `risk-engine` 每 5 分钟):
- USAGE_THRESHOLD: 扫近窗口 TokenUsage 求和,超阈值 → 创建 RiskFlag + 触发 action
- IP_LIMIT: 扫近窗口 User.lastLoginIp,同 IP 注册账号数 → 创建 RiskFlag
- REFUND_RATE: 计算 refunded/total 比例 → 创建 RiskFlag

**第三方反欺诈**:webhook 触发,external 调 `/admin/v2/risk-rules/webhook/:provider`,后端校验签名后 创建 RiskFlag。

### 8.4 API

```
# RiskRule CRUD
GET    /admin/v2/risk-rules
POST   /admin/v2/risk-rules
GET    /admin/v2/risk-rules/:id
PUT    /admin/v2/risk-rules/:id
DELETE /admin/v2/risk-rules/:id

# RiskList(子资源)
GET    /admin/v2/risk-rules/list-entries?listType
POST   /admin/v2/risk-rules/list-entries
DELETE /admin/v2/risk-rules/list-entries/:id

# RiskFlag(给 /risk-users 页用)
GET    /admin/v2/risk-users
GET    /admin/v2/risk-users/:id
POST   /admin/v2/risk-users/:id/release      解封
POST   /admin/v2/risk-users/:id/ban          永久拉黑
GET    /admin/v2/risk-users/:id/related      关联用户(同 IP/同设备)

# 第三方反欺诈 webhook
POST   /admin/v2/risk/webhook/:provider
```

### 8.5 admin 接入

- `/risk-rules` 5 Tab 接真实 API
- `/risk-users` 列表 + Drawer 4 Tab 接真实 API

---

## 9. PR7: Ticket(工单系统)

### 9.1 Schema

```prisma
model Ticket {
  id           String   @id @default(uuid())
  ticketNumber String   @unique               // TKT-YYYYMMDD-NNNNN
  userId       String
  subject      String
  category     TicketCategory
  priority     TicketPriority @default(NORMAL)
  status       TicketStatus   @default(OPEN)
  assigneeId   String?                        // adminMemberId
  createdAt    DateTime @default(now())
  resolvedAt   DateTime?
  closedAt     DateTime?

  user         User              @relation(fields: [userId], references: [id])
  messages     TicketMessage[]

  @@index([userId])
  @@index([status, priority])
  @@index([assigneeId, status])
  @@map("tickets")
}

enum TicketCategory { BILLING TECHNICAL REFUND FEATURE OTHER }
enum TicketPriority { URGENT HIGH NORMAL LOW }
enum TicketStatus { OPEN IN_PROGRESS RESOLVED CLOSED }

model TicketMessage {
  id           String   @id @default(uuid())
  ticketId     String
  authorType   TicketAuthorType
  authorId     String                          // userId 或 adminMemberId
  content      String                          // markdown
  attachments  String   @default("[]")         // JSON
  isInternal   Boolean  @default(false)        // 内部备注用户看不到
  createdAt    DateTime @default(now())

  ticket       Ticket   @relation(fields: [ticketId], references: [id], onDelete: Cascade)

  @@index([ticketId, createdAt])
  @@map("ticket_messages")
}

enum TicketAuthorType { USER ADMIN SYSTEM }
```

### 9.2 ticketNumber 生成

格式 `TKT-YYYYMMDD-NNNNN`(N 是当日序号,从 00001 起)。
用 Redis INCR 当天计数器实现:
```ts
const counterKey = `ticket:counter:${dayjs().format('YYYYMMDD')}`;
const n = await redis.incr(counterKey);
await redis.expire(counterKey, 86400 * 2);
const ticketNumber = `TKT-${dayjs().format('YYYYMMDD')}-${String(n).padStart(5, '0')}`;
```

### 9.3 SLA 计算

`URGENT`: 1h / `HIGH`: 4h / `NORMAL`: 24h / `LOW`: 72h
当工单 status=OPEN/IN_PROGRESS 且距 createdAt 超 SLA → 在 admin Alert 创建告警(关联 audit alerts)。

### 9.4 API

```
GET    /admin/v2/tickets                       列表
POST   /admin/v2/tickets                       创建(运营代用户)
GET    /admin/v2/tickets/:id                   详情(返回 ticket + messages)
POST   /admin/v2/tickets/:id/messages          回复
PATCH  /admin/v2/tickets/:id/status            改状态
PATCH  /admin/v2/tickets/:id/assign            分配
PATCH  /admin/v2/tickets/:id/category          改分类
PATCH  /admin/v2/tickets/:id/priority          改优先级
POST   /admin/v2/tickets/:id/close             关闭
POST   /admin/v2/tickets/:id/merge             合并工单
```

用户端创建工单的 API 是 `/api/tickets`(用户视角),用户端做工单提交时调,本 PR 一并实现一个最简版:

```
POST /api/tickets       用户创建工单
GET  /api/tickets       用户看自己的工单列表
GET  /api/tickets/:id   用户看自己的工单详情
POST /api/tickets/:id/messages  用户回复
```

用户端 UI 不在本 PR 范围,但 API 提供。

### 9.5 BullMQ Job

`ticket-sla` 每 30 分钟:
```ts
const slaHours = { URGENT: 1, HIGH: 4, NORMAL: 24, LOW: 72 };
const overdue = await prisma.ticket.findMany({
  where: {
    status: { in: ['OPEN', 'IN_PROGRESS'] },
    createdAt: { lt: dayjs().subtract(maxSlaHours, 'h').toDate() },
  },
});
for (const t of overdue) {
  const slaH = slaHours[t.priority];
  if (dayjs().diff(t.createdAt, 'h') > slaH) {
    // 写入 Alert 表(spec v2 alerts 模块)
    await alertService.create({
      category: 'SECURITY',  // 或 SYSTEM
      severity: t.priority === 'URGENT' ? 'HIGH' : 'MEDIUM',
      subject: `工单 ${t.ticketNumber} SLA 超期`,
      context: { ticketId: t.id, slaHours: slaH },
    });
  }
}
```

### 9.6 admin 接入

`/tickets` 列表 + 详情接入真实 API。详情页 :
- 左 60% 对话流(显示 messages 按 createdAt 排,USER/ADMIN/SYSTEM 三种气泡)
- 右 40% 用户上下文 sidebar(调现有 userManageApi.overview)
- 顶部操作栏(分类/优先级/状态/处理人/合并/关闭)
- 底部回复编辑器

---

## 10. 数据迁移与兼容性

### 10.1 现有数据冲击

- PR1-3 + PR5-7: 全是新表,不影响现有数据
- PR4: ModelPricing 加 14 列(全 nullable),现有行不受影响
- CreditTransaction 加 expiresAt/grantRuleId/isExpired 三个字段(都 nullable):现有流水默认 expiresAt=null(永久),isExpired=false,无回归

### 10.2 Migration 顺序

按 PR 顺序应用,每个 PR 一个 migration。

### 10.3 回退

每个 migration 写好 `down` 路径(prisma 的 migration 文件 + manual revert SQL)。
PR1 PR5 PR6 之间有外键引用(grant.segmentId / flag.ruleId),回退时按相反顺序: PR7 → PR6 → ... → PR1。

### 10.4 测试环境验证流程

每个 PR:
1. 本地起后端 + admin,调 API 跑通
2. 单元测试 + 集成测试 全过
3. 推 origin/newsaas 后 sync_saas_test.sh -r 部署
4. saas-test 上手动验证:
   - admin 能创建/编辑/删除新功能数据
   - BullMQ Job 能正常执行(至少观察一轮)
   - 不影响现有功能(用户登录/订单/订阅/支付都正常)
5. 验证通过 → 进入下一个 PR

---

## 11. 测试与覆盖率

### 11.1 单元测试

每个 service 至少 70% lines coverage。
重点测试:
- Schema 写入读取(通过 Prisma client 跑)
- Rule engine(parser / executor)
- BullMQ Job 的核心逻辑(事件触发 + 数据写入)

### 11.2 集成测试

每个 PR 至少 1 个 e2e 测试:
- 调 API → 数据库写入 → 查询验证

例如 PR1:
```ts
test('UserSegment full flow', async () => {
  // 创建静态分群
  const seg = await api.post('/admin/v2/user-segments', { name: 'VIP', ruleType: 'STATIC' });

  // 添加成员
  await api.post(`/admin/v2/user-segments/${seg.id}/members`, { userIds: ['u1', 'u2'] });

  // 查列表
  const list = await api.get('/admin/v2/user-segments');
  expect(list.items).toContainEqual(expect.objectContaining({ id: seg.id, memberCount: 2 }));

  // 查成员
  const members = await api.get(`/admin/v2/user-segments/${seg.id}/members`);
  expect(members.items).toHaveLength(2);
});
```

### 11.3 BullMQ Job 测试

每个 Job 单独可触发(不等 cron),便于测试:
```ts
test('CreditGrantJob executes daily rules', async () => {
  // setup: 一条规则 + 1 个匹配用户
  // 手动触发
  await creditGrantQueue.add('test', {});
  await waitForJobCompletion();
  // 验证: GrantRedemption 表有记录, CreditTransaction 有 expires
});
```

### 11.4 覆盖率门槛

- 整体 70% lines / 60% branches
- 关键路径(rule engine / grant executor / risk engine)90%+

---

## 12. 性能与索引

### 12.1 索引设计

- UserSegmentMember: `(segmentId, userId)` unique + `(userId)` 反查
- CreditTransaction: `(userId, expiresAt, isExpired)` 用于扣减时按过期时间排序
- RiskFlag: `(userId, status)` 用于查某用户当前风险状态
- TicketMessage: `(ticketId, createdAt)` 用于按时间渲染对话流
- ModelPricing: `(provider, isPublished)` 用于用户端模型市场查询

### 12.2 N+1 防护

- UserSegment 列表带 memberCount(已缓存)
- TicketsPage 列表用 `include: { messages: { take: 1, orderBy: { createdAt: 'desc' } } }` 预拉最近一条
- 用户端调用 API 检查策略时,Member/Team 用 dataloader 批量

### 12.3 BullMQ 单点保护

每个 Repeatable Job 用 `lockDuration: 60000` 配置,防止 multi-instance 重复执行。
Job 失败重试 3 次,backoff exponential。

---

## 13. 实施风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| Rule engine 字段聚合复杂(monthlySpentCents 等) | 性能差 | raw query + 索引 + 分群 memberCount 缓存 |
| BullMQ 多实例重复执行 | 重复发积分 | lockDuration + lock key + 幂等 GrantRedemption |
| Migration 失败 | 数据库脏 | 每个 migration transaction + 实测 down 路径 |
| 现有 CreditTransaction 增字段影响 | 现有逻辑回归 | 字段全 nullable + 默认值 + 现有代码不查这些字段 |
| 风控误杀 | 用户被错封 | 默认 ACTION=ALERT 而非 BLOCK + admin 可解封 |
| Ticket SLA 告警噪音 | 告警过多 | 仅触发一次(Alert 表 dedup by ticketId) |
| 某 PR 失败影响其他 | 阻塞 | PR 间相互独立(除 grant 引用 segment 软依赖) |

---

## 14. 决策记录

| 决策 | 结论 | 理由 |
|---|---|---|
| 实施范围 | P1 7 个能力 | 用户选 C(全部 P1 一起),但 spec §19 全功能(选 B) |
| PR 策略 | 每能力一 PR | 风险隔离,逐个验证 |
| PR 顺序 | 依赖在前 | UserSegment 在 CreditGrant 之前 |
| UserSegment 字段集 | 8 字段 | 中等集,覆盖常用运营场景 |
| Cron 形态 | BullMQ Repeatable | 多实例自动单点 |
| ModelPricing 升级 | 加 14 字段不动现有 | 兼容 + 渐进 |
| 风控默认动作 | ALERT 而非 BLOCK | 防误杀 |
| 工单 SLA | URGENT 1h / HIGH 4h / NORMAL 24h / LOW 72h | 业界惯例 |
| 测试覆盖率门槛 | 70% / 60% | 务实 + 关键路径加严 |

---

## 15. 后续 Phase

P2(下一轮 spec):
- ReferralProgram + Redemption(邀请裂变)
- UserBalance.creditLimit + CreditPolicyConfig(信用额度)
- UserSubscription 状态机字段(订阅生命周期 4 Tab)
- Alert 表扩展 + AdminAlert handler

P1 完成后再开 P2 spec。

---

## 参考

- v2 admin spec: `docs/superpowers/specs/2026-04-28-admin-redesign-v2-design.md`
- v2 admin plan: `docs/superpowers/plans/2026-04-29-admin-redesign-v2.md`
- 现有 Prisma schema: `apps/api/prisma/schema.prisma`
- 现有 BullMQ 配置: `apps/api/src/integration/`(webhook 重试已用)

---

## End of Spec
