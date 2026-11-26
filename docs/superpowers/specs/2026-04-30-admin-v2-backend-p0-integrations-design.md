# Admin v2 Backend P0 集成层 · Design Spec

- **Date**: 2026-04-30
- **Scope**: codesphere-admin-saas / apps/api(后端集成)
- **Owner**: 后端业务能力补全
- **Status**: Approved
- **Predecessor**: P1 7 个能力已部署 saas-test (HEAD `f80b9df`)
- **Next**: writing-plans

---

## 1. 背景

P1 已交付 7 个能力的 schema + service + admin UI,但**4 件关键集成被故意 deferred**。
不做这 4 件,P1 虽然能配规则,但**运营配置无法影响真实业务**:
- 配了定时奖励 → 用户实际收不到积分(grant 写了 CreditTransaction,但 Redis 池/扣款没接)
- 配了充值面额 → 用户充值时不享受赠送(支付流程没读 RechargeTier)
- 配了 BLACKLIST BLOCK → 实际请求不被拦截(ApiGateway 没调 isUserBlocked)
- 配了 BALANCE/BOOSTER_PACK reward → 只 logged warning,真实发放未实现

本 spec 把这 4 件做完。

## 2. 目标

让 P1 的 7 个能力**真正生效**,完整闭环:

| # | 集成项 | P1 现状 | P0 完成后 |
|---|---|---|---|
| 1 | CreditService FIFO + GRANT 池接入 | grant 只写 CreditTransaction,扣款不会优先扣 GRANT 类型 | 用户消费积分时按 expiresAt 升序优先扣最快过期的 GRANT,且过期 sweep 真实回收 |
| 2 | BALANCE / BOOSTER_PACK reward 发放 | grant-executor 拒绝/警告,只写 logged warning | 真实写 BalanceTransaction(BALANCE)或 UserBoosterPack(BOOSTER_PACK) |
| 3 | ApiGateway isUserBlocked 接入 | hook 已存在,无 caller | 用户登录前 + API 调用前调用,命中 BLACKLIST 返回 401/403 |
| 4 | RechargeTier 接入充值流程 | RechargeTier CRUD 已存在,支付流程不读 | 用户发起充值时检查 amount 是否匹配 active tier,自动应用 bonus |

## 3. 非目标

- ❌ 不改 P1 的 schema(已稳定)
- ❌ 不改 P1 的 admin UI(已上线)
- ❌ 不引入新 BullMQ job
- ❌ 不实现 P2(`/credit-policy` `/subscriptions` `/referrals` `/alerts` 等)
- ❌ 不改 Stripe / 微信 / 支付宝集成代码本身,只在它们调用的 service 层做拦截

## 4. 红线

- 不破坏现有 CreditService 已有功能(订阅积分扣减 / 加油包扣减 / 余额扣减)
- 不引入新的 schema 字段(本期纯逻辑层)
- 所有改动都要有单元测试 + 集成测试覆盖

---

## 5. PR 拆分

4 个独立 PR,按依赖顺序:

```
PR0-1  CreditService FIFO + GRANT 池接入
       ↓ (BALANCE 发放复用余额池逻辑)
PR0-2  rewardType=BALANCE / BOOSTER_PACK 真实发放
       ↓ (独立)
PR0-3  ApiGateway isUserBlocked 接入(rate-limit 拦截器层)
       ↓ (独立)
PR0-4  RechargeTier 接入充值流程
```

每个 PR 完成后部署到 saas-test 验证再进下一个。

---

## 6. PR0-1: CreditService FIFO + GRANT 池

### 6.1 现状梳理

**P1 中 GRANT 行为**:
1. CreditGrantExecutor 给用户发放 → `prisma.creditTransaction.create({ type: 'GRANT', amount, expiresAt, grantRuleId })`
2. **但**: Redis 中的扣款池(`credit:user:{id}:bonus` / `credit:user:{id}:quota`)**未被加值**
3. 用户调 API 扣款时,CreditService 走 `DEDUCT_CREDITS_LUA`,优先扣 bonus 池再扣 quota 池
4. GRANT 类型的 CreditTransaction 仅在数据库,Redis 不知道 → **用户实际余额没增加**

### 6.2 目标行为

- GRANT 发放时,把额度**加进 bonus 池**(GRANT 视同奖励/加油包,不进 quota)
- 扣款时,从 bonus 池里扣减,GRANT 类型的 CreditTransaction 联动更新已消费量
- 过期 sweep 时,从 bonus 池里扣减剩余的 GRANT 额度,反向 EXPIRE 流水

### 6.3 实现策略

**新增 GRANT 池**(独立于 bonus/quota,避免污染加油包逻辑):
- Redis key: `credit:user:{userId}:grant`
- 整数,单位:积分
- 持有所有未过期、未用尽的 GRANT 总和

**扣款顺序调整**:
```
原: bonus → quota
新: grant → bonus → quota
```

GRANT 池在 bonus 之前(GRANT 来自定时奖励,有过期时间,优先扣最先过期的)。

**Lua 脚本扩展**: 修改 `DEDUCT_CREDITS_LUA` 加 grant 池支持。
- 三池叠扣:取 grant 池余额,扣 min(需扣量, grant 余额),余额扣完进入 bonus
- 返回 deducted_grant / deducted_bonus / deducted_quota 三个数值

**扣减后联动 GrantRedemption**:
- 扣完后异步任务: 找用户最快过期的未用尽 GrantRedemption,扣 isUsedUp 标记或 partial usage
- 简化版本(本 PR): 用一个新表/列追踪 `used_amount`(GrantRedemption 加 used_amount Int @default(0))
  - 扣一笔时按 expiresAt asc 顺序扣 GrantRedemption.used_amount += take(amount, remaining = total - used_amount)
  - 当 used_amount === amount → isUsedUp = true

**过期 sweep 调整**:
- 找到过期的 GrantRedemption(expiresAt < now, isExpired=false, isUsedUp=false)
- 计算 remaining = amount - used_amount
- 从 grant 池扣 remaining(用 atomic Lua: 不能让用户余额变负)
- 写反向 EXPIRE 流水
- 标记 isExpired=true

### 6.4 Schema 改动

仅扩展 `GrantRedemption`:

```prisma
model GrantRedemption {
  // 现有字段...
  usedAmount  Int      @default(0) @map("used_amount")  // 已消费的部分
  // 现有 isUsedUp 仍然保持(used_amount === amount 时设为 true)
}
```

migration: ALTER TABLE grant_redemptions ADD COLUMN used_amount INT NOT NULL DEFAULT 0;

### 6.5 验证

- 创建一条 DAILY_CRON 规则 reward=300 expirePolicy=SAME_DAY_END
- 触发 manual-trigger
- 用户 API 扣款 100 → grant 池减 100, GrantRedemption.used_amount=100
- 用户继续扣 250 → grant 池减剩余 200,GrantRedemption.used_amount=300, isUsedUp=true; bonus 池扣 50
- 第二天 0:30 cron 触发 expire sweep → 该 GrantRedemption 已 isUsedUp,跳过

### 6.6 不在范围

- 不改前端展示(用户端余额查询会自动包含 grant 池)
- 不改 admin Dashboard 显示

---

## 7. PR0-2: BALANCE / BOOSTER_PACK reward 真实发放

### 7.1 现状

`CreditGrantExecutor.grantToUser()` 在 `rewardType=BALANCE` 或 `BOOSTER_PACK` 时只 `logger.warn` 然后跳过,不实际发放。

### 7.2 目标

- `rewardType=BALANCE`: 给用户的 UserBalance(若有 productId)加 amount cents,写 BalanceTransaction
- `rewardType=BOOSTER_PACK`: 创建一条 UserBoosterPack(用户拥有的加油包)记录,关联 BoosterPack 模板

### 7.3 实现

**BALANCE 分支**:
- 必须 productId 不为 null(BALANCE 是按量产品的预付余额)
- 调用 BalanceService.credit(userId, productId, amountCents, reason='grant', metadata={ruleId})
- 写 BalanceTransaction(type=ADJUST, 因现有 TransactionType enum 无 GRANT 值;
  description 编码 `grant-rule:{id} product:{id}` 用于追溯)
- balanceAfterCents 在事务提交后用 Redis incrby 真实余额回写
  (与现有 recharge/deduct/adjust 路径一致,均以 Redis 为真相),
  避免与并发 recharge 串台导致审计快照倒置

**BOOSTER_PACK 分支**:
- rewardAmount 字段含义改为 BoosterPack.id(应该用一个新字段更清晰? 但 spec 里没新字段...)
- **决策**: 不引入新字段, BOOSTER_PACK 的 rewardAmount 解释为"加油包模板 ID 的数字编码"或"购买数量"。复杂度高。
- **简化**: 本 PR 不实现 BOOSTER_PACK,只实现 BALANCE。BOOSTER_PACK 留 P2/P3
- 理由: BOOSTER_PACK 的 reward 模型在 P1 spec 中未定义清楚,贸然实现会有歧义

### 7.4 范围调整

PR0-2 仅做 BALANCE,BOOSTER_PACK **明确 deferred 到 P2 + 写 deferred 注释**。

### 7.5 校验

- 创建一条规则 rewardType=BALANCE rewardAmount=1000 productId=AI 写作
- 触发 manual-trigger
- 用户的 AI 写作余额 +1000 cents,BalanceTransaction 有一行 type=GRANT, amount=1000

---

## 8. PR0-3: ApiGateway isUserBlocked 接入

### 8.1 现状

`RiskEngineService.isUserBlocked(userId, ip, email): Promise<boolean>` 已实现,无 caller。

### 8.2 集成点

需要在两个层接入:

**a. 登录前**(防止黑名单用户拿到 token):
- File: `apps/api/src/auth/auth.service.ts` (或同等位置)
- 在 `loginWithEmail` / `loginWithAuth0` / 创建 session token 之前调 `riskEngine.isUserBlocked(userId, req.ip, email)`
- 命中 → 抛 ForbiddenException("账号已被风控冻结")

**b. API 调用前**(对已登录用户的实时拦截):
- File: 应用层 NestJS Guard 或 Interceptor
- 选项 A: 加全局 Guard `RiskCheckGuard`,所有需要鉴权的请求跑(性能成本)
- 选项 B: 加在 Token 验证 hook(JwtAuthGuard 内部或之后)
- 选项 C: 用现有的 `BillingDeductInterceptor` 之类的位置(只对计费请求生效)

**决策**: 用选项 B(JwtAuthGuard 内部),性能影响最小:
- 已经在 token 验证后拿到 userId
- 加一行 `const blocked = await this.riskEngine.isUserBlocked(userId, req.ip)`
- 命中 → 抛 ForbiddenException

带 Redis 60s TTL 缓存(避免每请求 2 次 DB 查询):
- key: `risk:blocked:{userId}` → boolean
- 命中黑名单时同步刷新(避免延迟)

### 8.3 性能 / 缓存

- TTL 60 秒(风控时效性 vs 性能权衡)
- 黑名单变更时主动失效:
  - `RiskListService.add` / `remove` 后 publish "risk:invalidate" event
  - 简化: 不主动失效,等 TTL 自然过期(60s 内偶尔漏拦截)
- 启动时:不预加载,首次请求时按需

### 8.4 验证

- 黑名单加 alice@example.com
- alice 登录 → 401/403
- 已有 alice token 调 API → 403
- 移除黑名单 → 等 60s,alice 恢复

---

## 9. PR0-4: RechargeTier 接入充值流程

### 9.1 现状

RechargeTier 表存在,admin 可配。但用户发起充值时(Stripe / 微信 / 支付宝)不读 RechargeTier。

### 9.2 集成点

**充值发起**:
- File: `apps/api/src/payment/` 下创建充值订单的 service 方法
- 用户传 `productId` + `amountCents` → 后端检查是否匹配 RechargeTier
- 匹配 active tier(amountCents 一致 + isActive=true + 当前时间在 startAt~endAt 内):
  - 计算 bonusCents:
    - bonusType=FIXED → bonusCents = bonusValue
    - bonusType=PERCENT → bonusCents = floor(amountCents * bonusValue / 100)
  - 在 Order metadata 写入 `tierId` + `bonusCents`
- 不匹配:正常充值,无 bonus

**充值到账时**(Stripe webhook 等):
- 现有逻辑给用户余额 +amountCents
- 新增: 读 Order.metadata.tierId 和 bonusCents
- 若有 bonus → 给用户余额额外 +bonusCents
- 写一行 BalanceTransaction(type=RECHARGE_BONUS, amount=+bonusCents, metadata={tierId})

### 9.3 校验

- 配充值面额: 充 100 送 10
- 用户充 100 → 订单金额 100,余额到账时 +110
- BalanceTransaction 两行: RECHARGE +100 / RECHARGE_BONUS +10
- 用户充 50(不匹配) → 余额 +50,无 bonus

### 9.4 异常处理

- 用户传 `tierId` 但 amountCents 不匹配 → 拒绝
- 时间窗口过期的 tier → 当作不匹配,正常充值无 bonus
- bonusType=PERCENT 时 bonusValue 超 100 → schema 已校验,但运行时再校验一次

---

## 10. 测试

每个 PR 至少:
- 1 个集成测试(setup → mutate → assert end-to-end)
- 单元测试覆盖关键边界

PR0-1: CreditService.deduct 三池叠扣 + 过期 sweep
PR0-2: BALANCE 发放真实写 BalanceTransaction
PR0-3: 黑名单用户被拦截 + 缓存命中/失效
PR0-4: 充值匹配 tier → bonus 应用

---

## 11. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| Lua 脚本逻辑复杂(三池叠扣) | 扣款错误,余额不一致 | 保留旧 Lua 版本作 fallback,新版本灰度后切换;集成测试覆盖各组合 |
| isUserBlocked 性能拖累所有 API | 每请求 2 次 DB 查询 | 60s Redis TTL,平时命中缓存 |
| RechargeTier 与 Stripe metadata 兼容 | 用户已发起的充值丢数据 | metadata 新增字段 nullable,旧订单不受影响 |
| GrantRedemption.used_amount 数据迁移 | 现有 Redemption 都是 0,但用户已用过的"假"GRANT 统计错误 | 现有 GrantRedemption 数据是 P1 部署后产生的,数量很少;假定都未消费 |

---

## 12. 决策记录

| 决策 | 结论 | 理由 |
|---|---|---|
| FIFO 用专门的 grant 池 | 是 | 不污染 bonus 逻辑(加油包独立),便于过期清算 |
| BOOSTER_PACK 是否本期实现 | 否,延后 | rewardAmount 含义不清,需要专门 schema 设计 |
| isUserBlocked 接入位置 | JwtAuthGuard 内部 | 拿到 userId 后最自然,性能影响最小 |
| isUserBlocked 缓存策略 | 60s TTL,不主动失效 | 简化第一版,黑名单变更最长 60s 才生效 |
| RechargeTier 时间窗口过期 | 静默 fallback 为无 bonus | 防止用户卡在结账页 |
| BalanceTransaction.type 用 ADJUST 还是新增 GRANT | 用 ADJUST + description 编码 | 现有 TransactionType enum 没有 GRANT 值;新增 enum 值会触发 schema 迁移和广泛影响;ADJUST 语义兼容(中性余额调整),description 里编码 `grant-rule:{id} product:{id}` 即可追溯。代价:GRANT 类型在余额流水里看不到独立分类,需要按 description 前缀过滤 |
| BALANCE grant 的 balanceAfterCents 计算方式 | 事务外用 Redis incrby 返回值回写 | 现有 recharge/deduct/adjust 路径都以 Redis 为真相;若用事务内 findFirst+amount 估算,与并发 recharge 交织时审计序列会错乱 |

---

## End of Spec
