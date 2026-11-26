# Admin v2 Backend P2 Funnel · Design Spec

- **Date**: 2026-04-30
- **Scope**: codesphere-admin-saas / apps/api(后端) + 已有 admin 前端 stub 接入
- **Owner**: 后端业务能力补全
- **Status**: Draft
- **Predecessor**: P2 Alerts(A1/A2/A3)已部署 saas-test
- **Next**: writing-plans

---

## 1. 背景

P1 admin v2 重构上线后,前端 `/funnel` 页面已写好,通过 `apps/admin/src/api/v2/funnel.ts` 调三个端点:
- `GET /admin/v2/funnel` — 总漏斗(注册→激活→付费→续订)
- `GET /admin/v2/funnel/subscription` — 订阅模式专属漏斗
- `GET /admin/v2/funnel/payg` — 按量模式专属漏斗

**所有端点后端未实现** —— 列表返回 404,前端进 stub 模式只展示骨架。

运营在 saas-test 上看不到真实业务转化数据,只能从单条订单/订阅推。Funnel 模块要把现有的 User / Order / UserSubscription / BalanceTransaction 数据**只读聚合**,不引入任何新写入路径。

## 2. 目标

| # | 端点 | 现状 | P2-B 完成后 |
|---|---|---|---|
| 1 | `GET /admin/v2/funnel` | ❌ | 注册→激活→付费→续订 4 步漏斗,可按 segmentId 分群 |
| 2 | `GET /admin/v2/funnel/subscription` | ❌ | 订阅专属:注册→订阅(任何 plan)→付费(非 free)→续订(2 期及以上) |
| 3 | `GET /admin/v2/funnel/payg` | ❌ | 按量专属:注册→首充(成功 RECHARGE 订单)→消费(BalanceTransaction CONSUME)→复购(>=2 次 RECHARGE) |

每个端点接受 `days` 查询参数(默认 30,接受 7/30/90),按用户 createdAt 落入"近 N 天"窗口。
总漏斗额外接受 `segmentId`(可选,过滤到 UserSegment 静态成员)。

## 3. 非目标

- ❌ 不引入新表 / 新字段(纯聚合 + 索引扫现有表)
- ❌ 不实时推送(每次 GET 即查,有 30s 短缓存)
- ❌ 不做 cohort 留存矩阵(单期漏斗,多期对比留 P3)
- ❌ 不做用户级 drill-down(列表点进去看明细,留 P3)
- ❌ DYNAMIC segment 暂不支持(只支持 STATIC,DYNAMIC 需要 RuleEngine,跨模块依赖大)
- ❌ 不引入新 BullMQ job
- ❌ 不接外部 BI(MixPanel/Amplitude)

## 4. 红线

- **纯只读** —— 任何 funnel 查询绝不能写任何数据
- 查询性能 <500ms (saas-test 数据量 <10k 用户场景下)
- pageSize 上限不适用(无分页,只返聚合数);返回结构紧凑
- 现有索引足够,**不加新索引**(P2-A3 已加 [userId, createdAt],其他用 schema 现有)
- 不修改 User/Order/UserSubscription/BalanceTransaction 任何 schema

---

## 5. 单 PR 实施

P2-B 一个 PR 完成:Service + Controller + 测试。Module 挂入 AppModule。

---

## 6. Funnel 步骤定义

> **时间窗口语义(cohort funnel)**:`days` 参数仅限定 step1 register —— 用户必须在窗口内
> 注册才进入 cohort 分母。后续步骤(activated / paid / retained 等)**不再过滤 createdAt**,
> 看这批 cohort 用户**至今为止**的状态。这是行业标准 cohort funnel 语义,与 §9 决策一致。

### 6.1 总漏斗(`/admin/v2/funnel`)

| 步骤 | key | label | 数据来源 |
|---|---|---|---|
| 1 | `register` | 注册 | `User WHERE createdAt >= now-Nd AND deletedAt IS NULL [AND id IN segmentMembers]` |
| 2 | `activated` | 激活 | 上一步用户中,`User.lastLoginAt IS NOT NULL`(登录过至少一次) |
| 3 | `paid` | 付费 | 上一步用户中,**任一**:`Order.status='COMPLETED' AND amountCents > 0` |
| 4 | `retained` | 续订 | 上一步用户中,**至少 2 笔** Order COMPLETED(订阅续费 / 重复充值都算) |

每步 value = 用户去重数(同一用户多个订单只算一次)。
`steps[i].value <= steps[i-1].value` 严格不增。

### 6.2 订阅漏斗(`/admin/v2/funnel/subscription`)

| 步骤 | key | label | 数据来源 |
|---|---|---|---|
| 1 | `register` | 注册 | 同上 |
| 2 | `subscribed` | 订阅 | 上一步用户中,`UserSubscription` 存在(任何 plan,含 free) |
| 3 | `paid_subscription` | 付费订阅 | 上一步用户中,有 `Order.orderType='SUBSCRIPTION' AND status='COMPLETED'` |
| 4 | `renewed` | 续订 | 上一步用户中,SUBSCRIPTION COMPLETED Order count >= 2 |

### 6.3 按量漏斗(`/admin/v2/funnel/payg`)

| 步骤 | key | label | 数据来源 |
|---|---|---|---|
| 1 | `register` | 注册 | 同上 |
| 2 | `first_recharge` | 首充 | 上一步用户中,有 `Order.orderType='RECHARGE' AND status='COMPLETED'` |
| 3 | `consumed` | 消费 | 上一步用户中,有 `BalanceTransaction.type='CONSUME' AND amountCents > 0`(注:CONSUME 在表里 amountCents 通常是负或正?查 schema 确认,语义是消费过) |
| 4 | `repurchased` | 复购 | 上一步用户中,RECHARGE COMPLETED Order count >= 2 |

---

## 7. Service / Controller

### 7.1 FunnelService(`apps/api/src/funnel/funnel.service.ts`)

```ts
@Injectable()
export class FunnelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,  // 30s 缓存
  ) {}

  async getOverallFunnel(opts: { days: number; segmentId?: string }): Promise<FunnelData>;
  async getSubscriptionFunnel(opts: { days: number }): Promise<FunnelData>;
  async getPaygFunnel(opts: { days: number }): Promise<FunnelData>;
}
```

每个方法:
- 验证 `days` ∈ {7, 30, 90},否则 fallback 30
- 检查 30s Redis 缓存:`funnel:overall:{days}:{segmentId||all}` / `funnel:sub:{days}` / `funnel:payg:{days}`
- 缓存命中 → 返回
- 缓存 miss → 跑聚合 SQL → 写入缓存(SET EX 30)→ 返回

聚合 SQL **每步独立查**,用 `SELECT COUNT(DISTINCT user_id) FROM ... WHERE user_id IN (上一步 userIds)` 风格。 用 raw SQL `prisma.$queryRaw` 比 Prisma DSL 更直观,**只用 prisma 已声明的表名**(避免 SQL 注入用 `Prisma.sql` template)。

### 7.2 FunnelController(`apps/api/src/funnel/funnel.controller.ts`)

`@Controller('admin/v2/funnel')` + `AdminJwtAuthGuard, AdminPermissionGuard` + `@RequireAdminPermission('admin.monitoring.view')`(漏斗属业务监控)

| 路由 | 行为 |
|---|---|
| `GET /` | overall(query: days, segmentId) |
| `GET /subscription` | subscription(query: days) |
| `GET /payg` | payg(query: days) |

### 7.3 测试

- service 单元测试:每步 SQL 返回 mock 数,验证聚合结构正确
- 缓存命中/miss 路径
- segmentId STATIC segment 过滤生效
- segmentId 不存在 / DYNAMIC segment → 返空漏斗(graceful)
- days 异常值 fallback 30

---

## 8. 性能保障

- 30s Redis 缓存:同一 days+segmentId 30s 内只查一次
- 现有索引 `User(createdAt)`,`Order(userId, status, orderType)`,`UserSubscription(userId, status)`,`BalanceTransaction(userId, type)`,`CreditTransaction(userId, createdAt)` 应已足够支撑
- 数据量 <10k 用户的 saas-test 上,p95 应在 200ms 内

---

## 9. 决策记录

| 决策 | 结论 | 理由 |
|---|---|---|
| 总漏斗 4 步定义 | 注册→激活(登录)→付费(任意 COMPLETED Order)→续订(≥2 笔) | 行业标准漏斗,跟 SaaS 业务直观对应 |
| 续订定义包不包"订阅未取消" | 不包(本期只看 Order count) | "订阅未取消" 信号强但需要联 UserSubscription,本期简化 |
| comparedTo 字段 | 本期不返,留 null | 单期就够看。多期对比留 P3 |
| 缓存策略 | Redis 30s 短缓存,key 含 days+segmentId | 平衡:数据足够实时(30s 内变化对运营观测影响小)+ 防止重复刷新拖垮 PG |
| segmentId DYNAMIC 支持 | 否,本期只支 STATIC | DYNAMIC 需要 RuleEngine 跨模块,超 P2-B 范围 |
| 权限 | admin.monitoring.view | 漏斗属业务监控,与现有 monitoring 权限对齐 |
| 不加新索引 | 现有索引足够 saas-test 数据量 | 大盘真上 prod 后,SQL EXPLAIN 跑过再决定 |

---

## 10. 后续工作(P3 候选)

- 多期对比(comparedTo)
- 用户级 drill-down(每步点进去看用户列表)
- DYNAMIC segment 支持
- cohort 留存矩阵
- 接 BI 平台(MixPanel/Amplitude)

---

## End of Spec
