# Admin v2 Backend P2 CreditPolicy · Design Spec

- **Date**: 2026-04-30
- **Scope**: codesphere-admin-saas / apps/api(后端) + 已有 admin 前端 stub 接入
- **Owner**: 后端业务能力补全
- **Status**: Draft
- **Predecessor**: P2 Alerts / Funnel 已部署 saas-test
- **Next**: writing-plans

---

## 1. 背景

P1 admin v2 重构上线后,前端 `/credit-policy` 页面已写好,通过 `apps/admin/src/api/v2/creditPolicy.ts` 调五个端点(全局/分群配置 CRUD + 透支用户列表)。**所有端点后端未实现**。

按量付费(PAY_AS_YOU_GO)产品的运营痛点:
- 用户充值后预付余额扣到 0 → 后续 deduct 应该被拒绝
- 但 Redis Lua 原子扣检查的是 `>=0`,理论已经禁止透支
- **真正的运营需求**:某些 VIP 用户**允许透支**(白名单分群),普通用户严格不允许;触发透支后能告警/暂停

CreditPolicy 模块就是把这个"分群透支策略"参数化,可视化配置,实时生效。

## 2. 目标

| # | 端点 | 现状 | P2-C 完成后 |
|---|---|---|---|
| 1 | `GET /admin/v2/credit-policy/global?productId=` | ❌ | 返产品的全局 policy(单条) |
| 2 | `PUT /admin/v2/credit-policy/global` | ❌ | upsert 产品全局 policy |
| 3 | `GET /admin/v2/credit-policy/segments?productId=` | ❌ | 列产品的所有 segment 覆盖 |
| 4 | `POST /admin/v2/credit-policy/segments` | ❌ | upsert segment 覆盖 policy |
| 5 | `GET /admin/v2/credit-policy/overdue-users` | ❌ | 列当前透支用户(余额 < 0) |

外加:
- `BillingService.deduct` hook 实时检查 policy,allowOverdraft=false 且 newBalance < -limit 时拒绝
- 仅 PAY_AS_YOU_GO 产品能配 policy(其他产品 schema 校验 + 前端约束)

## 3. 非目标

- ❌ ALERT triggerAction(发 AlertEvent)— 留 P3,本期 SUSPEND 一种 action
- ❌ EMAIL triggerAction — 留 P3
- ❌ recoveryCondition 自动恢复(ON_RECHARGE / AFTER_DAYS / MANUAL)— schema 落字段但本期不实现自动逻辑,运营手动调
- ❌ 透支用户每日定期扫描 BullMQ — 本期 listOverdueUsers 是 GET 实时查
- ❌ 订阅 / CodingPlan 产品的 policy(spec §10 决策:仅 PAYG)
- ❌ 不做信用评分 / 风控联动(留 P3 接 RiskEngine)

## 4. 红线

- BillingService.deduct 主链路加 hook,**性能影响 <2ms**(Redis cache 60s 拿 policy)
- policy 变更立即生效(Redis cache 主动失效 + TTL 60s 兜底)
- 不引入新 BullMQ
- schema 改动只新增表,不修现有
- policy 加载失败(Redis/PG 故障)→ **fallback 到"不允许透支"**(保守策略,防止配置错误导致大额透支)

---

## 5. 单 PR 实施

P2-C 一个 PR 完成:Schema + Service + Controller + BillingService.deduct hook + 测试。Module 挂入 AppModule。

---

## 6. Schema

```prisma
model CreditPolicy {
  id                       String                       @id @default(uuid())
  productId                String                       @map("product_id")
  scope                    CreditPolicyScope            // GLOBAL / SEGMENT
  segmentId                String?                      @map("segment_id")  // null when scope=GLOBAL
  allowOverdraft           Boolean  @default(false)     @map("allow_overdraft")
  defaultCreditLimitCents  Int      @default(0)         @map("default_credit_limit_cents")
  triggerAction            CreditPolicyTriggerAction    @default(SUSPEND) @map("trigger_action")
  recoveryCondition        CreditPolicyRecoveryCondition @default(ON_RECHARGE) @map("recovery_condition")
  recoveryDays             Int?                         @map("recovery_days")
  createdAt                DateTime                     @default(now()) @map("created_at")
  updatedAt                DateTime                     @updatedAt      @map("updated_at")

  product Product       @relation(fields: [productId], references: [id], onDelete: Cascade)
  segment UserSegment?  @relation(fields: [segmentId], references: [id], onDelete: Cascade)

  @@unique([productId, scope, segmentId], name: "uniq_product_scope_segment")
  @@index([productId])
  @@map("credit_policies")
}

enum CreditPolicyScope {
  GLOBAL
  SEGMENT
}

enum CreditPolicyTriggerAction {
  SUSPEND
  ALERT
  EMAIL
}

enum CreditPolicyRecoveryCondition {
  ON_RECHARGE
  AFTER_DAYS
  MANUAL
}
```

User / Product / UserSegment 反向关系:
```prisma
model Product {
  // ...
  creditPolicies CreditPolicy[]
}
model UserSegment {
  // ...
  creditPolicies CreditPolicy[]
}
```

唯一索引 `(productId, scope, segmentId)`:
- 每个产品最多一条 GLOBAL(segmentId=null)
- 每个产品 + segmentId 最多一条 SEGMENT 覆盖

## 7. Service

### 7.1 CreditPolicyService (`apps/api/src/credit-policy/credit-policy.service.ts`)

```ts
@Injectable()
export class CreditPolicyService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  // ===== Admin CRUD =====
  async getGlobal(productId: string): Promise<CreditPolicy>;
  async upsertGlobal(productId: string, data: Partial<...>): Promise<CreditPolicy>;
  async listSegments(productId: string): Promise<CreditPolicy[]>;
  async upsertSegment(data: { productId; segmentId; ... }): Promise<CreditPolicy>;
  async listOverdueUsers(opts: { productId?; page; pageSize }): Promise<{ items; total }>;

  // ===== BillingService.deduct hook =====
  async resolvePolicyForUser(userId: string, productId?: string): Promise<EffectivePolicy>;
}

interface EffectivePolicy {
  allowOverdraft: boolean;
  creditLimitCents: number;  // 0 = 严格不许透支;>0 = 允许透支到 -creditLimitCents
}
```

### 7.2 resolvePolicyForUser 算法

1. 查 Redis cache `policy:user:{userId}:{productId||any}`(60s TTL)
2. 命中 → JSON.parse 返回
3. miss:
   - `userSegmentMember.findMany WHERE userId` → 用户所属 STATIC segments(DYNAMIC 暂跳)
   - `creditPolicy.findMany WHERE productId AND (scope=GLOBAL OR segmentId IN segments)`
   - 按 SEGMENT > GLOBAL 优先取(同一产品):
     - 如果有任何 SEGMENT 匹配 → 取该 SEGMENT policy
     - 否则取 GLOBAL policy
     - 都没有 → fallback 到 `{allowOverdraft: false, creditLimitCents: 0}`(保守策略)
   - 写 Redis cache 60s
   - 返回 EffectivePolicy
4. Redis 故障 / parse 损坏 → 走 PG 路径,不抛
5. PG 故障 → fallback 保守策略 + warn

### 7.3 BillingService.deduct hook

deduct 当前逻辑:`getBalance → Lua check >=0 atomic deduct → 流水`

新增前置检查(在 Lua 之前):
```ts
const policy = await this.creditPolicy?.resolvePolicyForUser(userId, /*productId*/);
const limit = policy?.allowOverdraft ? policy.creditLimitCents : 0;
const currentBalance = await this.getBalance(userId);
if (currentBalance - amountCents < -limit) {
  return { success: false, balance: currentBalance };  // 保留现有签名
}
// 继续走 Lua...
```

实际实现要小心:Lua 内部已经查 `>=0`,要把 Lua 改成接受可配置 `floor`(限额负值)。否则前置检查存在 race(检查后被并发扣到不允许的位置)。

**简化方案**(spec §10 决策):不改 Lua,只在 deduct 入口前置检查。前置检查是悲观估计(连续两笔扣款可能比检查时余额低),但用户无法主动绕过(每笔都会重新查一次)。

**关键**:CreditPolicyService 用 `@Optional()` 注入,policy 模块未加载时 deduct 行为退化为现状(就是不允许透支),不破坏现有 deduct 业务。

### 7.4 listOverdueUsers

实现:
- 找 `BalanceTransaction.balanceAfterCents < 0` 的最新一条 per user(GROUP BY userId 拿最新)
- 简化版:`balanceTransaction.findMany WHERE balanceAfterCents < 0 ORDER BY createdAt DESC` 然后 distinct user
- 每个用户列出:userId, email, productId(如有 BalanceTransaction.orderId 关联可拿,否则 null), balanceCents(当前 Redis 余额), overdueDays(从 balanceAfterCents 首次<0 起计), reason(text), creditLimitCents(从 policy 拿)

性能:扫 BalanceTransaction 表带索引 (balanceAfterCents)?现有索引已经有 (userId),(createdAt)。本期暂不加索引 — saas-test 量小不痛,prod 上量后再 EXPLAIN 决定。

### 7.5 Cache 失效

policy 写入时 (upsertGlobal/upsertSegment) → DEL `policy:user:*:{productId}` 模式(SCAN + DEL)。
SCAN 1000 keys 内 < 50ms,可接受。

或更简单:**不主动失效,等 60s TTL 自然过期**。policy 变更影响 60s 内不可见 → 运营场景能接受。

**决策(§10)**:不主动失效,60s TTL 自然过期。

## 8. Controller

`@Controller('admin/v2/credit-policy')` + `AdminJwtAuthGuard, AdminPermissionGuard`

| 路由 | 权限 | 行为 |
|---|---|---|
| GET /global?productId= | admin.plans.view | getGlobal |
| PUT /global | admin.plans.manage | upsertGlobal |
| GET /segments?productId= | admin.plans.view | listSegments |
| POST /segments | admin.plans.manage | upsertSegment |
| GET /overdue-users?productId&page&pageSize | admin.plans.view | listOverdueUsers |

权限沿用 admin.plans(信用额度属于产品计费配置)。

## 9. 测试

- service 单元:
  - resolvePolicyForUser SEGMENT 优先于 GLOBAL
  - resolvePolicyForUser 都没匹配 → 保守 fallback
  - resolvePolicyForUser Redis fail → 走 PG
  - resolvePolicyForUser PG fail → 保守 fallback + warn
  - upsertGlobal 创建 / 更新
  - listOverdueUsers 分页 + productId 过滤
  - 仅 PAYG 产品能配 policy(non-PAYG → BadRequest)
- BillingService.deduct hook:
  - allowOverdraft=false → 余额不足拒绝
  - allowOverdraft=true creditLimit=10000 → 允许扣到 -10000
  - 超过透支额度 → 拒绝
  - CreditPolicyService 注入失败(Optional)→ 退化到现状(不允许透支)

## 10. 决策记录

| 决策 | 结论 | 理由 |
|---|---|---|
| 适用产品类型 | 仅 PAY_AS_YOU_GO | 订阅/CodingPlan 没透支语义,简化 |
| triggerAction 本期支持 | 仅 SUSPEND | ALERT/EMAIL 留 P3 |
| recoveryCondition | schema 落字段,本期不自动恢复 | 配置先就绪,自动恢复留 P3 |
| Cache 失效 | 不主动 SCAN+DEL,等 60s TTL 过期 | 简化,60s 滞后可接受 |
| Policy 加载失败 fallback | 保守(不允许透支) | 配置错误时宁错杀不放过,防止意外大额透支 |
| Lua 是否改造 | 不改,仅前置检查 | 前置检查 race 风险小,改 Lua 影响面大 |
| BillingService.deduct 是否签名变 | 否,仅内部多调一次 resolvePolicy | 现有调用方零感知 |
| Service 注入策略 | @Optional() | 未 wire CreditPolicyModule 的现有测试不破坏 |
| listOverdueUsers 数据来源 | BalanceTransaction.balanceAfterCents < 0 实时扫 | 简化,不引入 cron/物化表 |

---

## 11. 后续工作(P3 候选)

- ALERT triggerAction(集成 P2-A AlertEvent)
- EMAIL triggerAction(集成邮件发送)
- recoveryCondition 自动逻辑(BullMQ 扫描)
- 透支用户物化表(性能优化)
- Lua 改造支持透支限额(消除前置检查 race)
- 信用评分集成(RiskEngine 联动)

---

## End of Spec
