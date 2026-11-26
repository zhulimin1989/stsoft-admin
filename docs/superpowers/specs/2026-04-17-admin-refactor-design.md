# CodeSphere Admin SaaS — 安全修复与架构解耦设计

> **日期**：2026-04-17
> **范围**：`/Users/shineli/ruidong/codesphere-admin-saas`
> **背景**：四维度 review 后的综合行动方案（架构 7.2 / 安全 7.2 / 计费 5.5 / 测试 4.5）
> **相关文档**：PROJECT-SPEC.md、CLAUDE.md、track/DECISIONS.md

---

## 1. 目标与非目标

### 目标
- **止血**：消除 5 个 CRITICAL 漏洞和计费超扣风险，生产环境可放心跑
- **解耦**：把模块化从"文件夹级"提升到"运行时级"，AdminService 不再是上帝类
- **可测**：关键金额路径（auth/payment/credit/apikey）达到 CLAUDE.md 要求的 100% 分支覆盖
- **可对账**：Admin 成为积分唯一真相源，消除与 codesphere-saas 的双写漂移

### 非目标
- 不做 UI 重设计（7 个 admin 页面 stash 到 Phase 2 再评估）
- 不引入新基础设施（BullMQ 走现有 Redis，不上 Kafka/RabbitMQ）
- 不迁移到微服务（保持 NestJS 模块化单体）
- 不改 Prisma schema 的业务表结构（只修 drift）

---

## 2. 路线图总览

| Phase | 时长 | 交付 | 验收 |
|---|---|---|---|
| **Phase 1 — 止血** | 2 周 | 5 个 P0 + 计费超扣修复 + 基线整理 | 扫描器干净 / 并发扣费压测无超扣 / 回归测试全绿 |
| **Phase 2 — 解耦** | 3–4 周 | AdminService Facade / Controller 下沉 / ILLMGateway / integration 模块 | AdminService < 400 行 / Controller 零 Prisma / 覆盖率 ≥ 60% |
| **Phase 3 — 收口** | 4–6 周 | 测试爬 85% / 前端类型收敛 / 对账脚本 / CI gate | CI gate 阻断 PR / 存量数据修复完成 |

**总时长**：约 2.5 个月。每个 Phase 间设用户确认关卡。

---

## 3. Phase 1 — 止血（2 周）

### 3.1 基线整理（Day 0，必须先做）

在任何修复开始前，清理工作区。当前 33 处未提交改动会让后续 subagent 并行工作互相干扰。

**立即提交**（P1-0 单个 commit）：
- `apps/api/prisma/migrations/20260416141000_fix_alerts_schema_drift/`
- `apps/api/prisma/migrations/20260416145500_fix_user_subscriptions_unique_drift/`
- `apps/api/src/auth/auth0-management.service.ts`（当前未 track，含 clientSecret 使用）
- `.env.example`
- `apps/api/src/auth/auth.service.spec.ts`、`admin-user-management.spec.ts` 已补齐的测试
- `e2e/admin/*`、`playwright.config.ts`
- `apps/web/` 5 个删除文件（架构下线确认）
- `test-results/.last-run.json`

**立即 stash**：
```bash
git stash push -m "UI refactor 7 pages - Phase 2" -- \
  apps/admin/src/pages/{Channels,Members,Monitoring,PaymentConfig,Roles,Users,UserDetail}/index.tsx \
  apps/admin/src/layouts/AdminLayout.tsx \
  apps/admin/src/api/admin.ts
```

**暂缓提交，等配套测试**：
- `apps/api/src/admin/admin.service.ts`（+149，含金额逻辑）→ Phase 1 P1-6 一起上
- `apps/api/src/auth/auth.service.ts`（+43）→ 已有 spec 覆盖，可随 P1-5 上
- `apps/api/src/billing/billing.service.ts`（status unknown）→ 走 P1-4

验收：`git status` 只剩要修的部分，工作区干净，subagent 并行不会踩到 UI 改动。

### 3.2 P0 安全修复（并行 5 个 subagent）

| ID | 标题 | 文件:行 | 根因 | 修复 | 回归测试 |
|---|---|---|---|---|---|
| **P1-1** | SQL 注入 | `admin/admin.repository.ts:288` | `$queryRawUnsafe` 字符串拼接 `sets` 数组 | 改用 Prisma `update()` 或参数化 `$queryRaw\`` 标签模板 | 新增恶意 roleId 注入用例，断言 Prisma 拒绝 |
| **P1-2** | SSRF | `channel/channel.service.ts:122` | `channel.baseUrl` 无校验直接 `fetch` | 新增 `url-guard.util.ts`：校验协议 http/https、DNS 解析、阻断 RFC1918 + 169.254/16 + ::1 + metadata IP；10s 超时保留 | mock DNS 返回 127.0.0.1 / 169.254.169.254 断言抛错 |
| **P1-3** | 支付验签 | `payment/payment.service.ts:477` 等 3 处 | 回调验签 TODO | 微信用 `wechatpay-node-v3` verify、支付宝用官方 SDK `rsaCheck`、Stripe 用 `constructEvent`；全部强制，验签失败 401 | 3 个 provider 分别构造伪造 payload 断言拒绝 |
| **P1-4** | 全局 Zod Pipe | `main.ts` + 所有 controller | 手工 `safeParse`，漏校验暴露 | 新增 `ZodValidationPipe`（复用 packages/shared schemas），`app.useGlobalPipes()` 注册；controller 里移除手工 `safeParse` | 新增未校验 DTO 的 controller 测试，断言 400 |
| **P1-5** | JWT expiresIn | `auth/auth.service.ts:172` | `jwtService.sign()` 未显式 expiresIn | Access 显式 `15m`、Refresh 显式 `7d`；从 `@Constants` 读；补 Access Token 过期边界 spec | 断言签出 token 的 exp 正确 |

**Subagent 组织方式**：
- 5 个 subagent 在 git worktree 隔离，避免 merge 冲突
- 每个 subagent 的任务卡：文件定位 + 修复细节 + 回归测试 + 验证命令
- 主会话做 PM，接到结果后串行 merge 回主分支，每个 merge 点跑一次 `pnpm typecheck && pnpm test --filter api`

### 3.3 P0 计费超扣修复（P1-6，关键路径）

**当前漏洞链**（sync.service.ts 证据链）：
1. codesphere-saas 先 `GET /sync/user-credits` 取快照（line 427-458）
2. 业务决策放行
3. codesphere-saas 再 `POST /sync/deduct-credits` 扣费（line 496-526）
4. 两步之间无版本戳/CAS，并发两个请求都读同一快照、各扣各的 → **超扣**
5. 幂等键只存 Redis TTL 24h，Redis 重启/故障即失效 → **双扣**

**修复设计**：

**a) 幂等键持久化**（DB 兜底）
- 新 model `IdempotencyKey { key @id, scope, userId, createdAt, result Json }`
- `sync.service.ts` 扣费入口：先查 DB，命中直接回放结果；未命中走 Lua 扣 + 插入 DB + 返回
- Redis TTL 继续当热缓存，但 DB 是兜底
- 唯一约束保证并发 INSERT 只成一个

**b) 扣费事务化**（Redis + PG 合成一个事务）
- 现状：`billing/credit.service.ts` Lua 扣 Redis 成功后 `await` 写 PG，PG 失败时 Redis 已扣，补偿困难
- 改为 **PG-first 同步方案**：
  1. PG transaction 开启，写 `BalanceTransaction(status=PENDING)` + 更新 IdempotencyKey
  2. Lua 脚本原子扣 Redis（含余额检查）
  3. Lua 成功 → PG 标 `status=COMMITTED` → commit
  4. Lua 失败（余额不足）→ PG rollback
  5. PG commit 失败 → 补偿 Redis `INCRBY` 回滚 + 记 alert
- PG 作为账本真相源，Redis 仅为并发性能层
- 为什么不走 Redis-list outbox：Redis 本身不是持久化存储（AOF 仍可能丢），outbox 必须落 PG 才可靠

**c) 同步机制重做**（codesphere-saas 不再做本地快照决策）
- `GET /sync/user-credits` 仍保留但标记 `@Deprecated`
- 新增 `POST /sync/check-and-deduct`（原子 RPC）：检查余额 + 扣费 + 返回扣后余额一个原子操作
- codesphere-saas 改为直接调新 RPC，放弃本地快照前置检查
- 这一侧改动不在本 spec 范围内，但 admin 侧必须先提供新 RPC

**d) Webhook 降级**
- `notifyProductSaas` 从"一致性机制"降级为"通知机制"，不再承担金额同步
- 仍然发，但加 HMAC 签名 + BullMQ 重试 + 死信队列（见 Phase 2 详述）
- Phase 1 只做 HMAC 签名 + 简单 setTimeout 重试 3 次，死信走日志告警

**验收**：
- 并发压测脚本（k6 或自写）：同一用户 100 并发调 deduct，断言最终扣除 = 100 × amount，不超扣
- Redis 故障演练：扣费中途杀 Redis，重启后 outbox worker 恢复到一致状态
- 双扣防护测试：同一 idempotency key 并发 20 次，断言只扣一次

### 3.4 Phase 1 测试策略
- 只给修复写回归测试（不追求整体覆盖率）
- 所有新测试走 `pnpm test --filter api`
- 覆盖率目标：修复涉及的文件 ≥ 80%，整体覆盖率不卡

### 3.5 Phase 1 验收
- [ ] 5 个 P0 各自 PR merge，回归测试绿
- [ ] 计费并发压测无超扣
- [ ] 幂等键 DB 表存在并被使用
- [ ] Webhook 带 HMAC 签名
- [ ] codesphere-saas 侧新 `/sync/check-and-deduct` 可调通（需要对方团队配合）
- [ ] `git status` 只剩 stash 的 UI 改动

---

## 4. Phase 2 — 解耦（3–4 周）

### 4.1 AdminService Facade 化

**目标**：`admin.service.ts` 从 1952 行缩到 < 400 行（纯编排 + 审计 + 权限校验）。

**拆分原则**（已决策：按资源拆 Facade，逻辑下沉到原模块）：

| AdminService 现有职责 | 下沉到 |
|---|---|
| 用户 CRUD / 重置密码 / 调额 | `user/user.admin.service.ts`（新增） |
| 渠道 CRUD / 测试 / 重置统计 | `channel/channel.admin.service.ts`（新增） |
| 套餐/订单/交易 | `billing/billing.admin.service.ts`（新增） |
| 角色 / 活动日志 | 保留在 `admin/` |
| 权限解析 / Facade 方法 | 保留在 `admin.service.ts` |

**命名约定**：`<module>.admin.service.ts` 放管理端特有逻辑（比如带 paginate + soft delete filter 的列表）；`<module>.service.ts` 保持用户侧业务逻辑不变，两者互不依赖。

**AdminController 不拆**（924 行可以忍），但改为调 Facade → 下游 admin service。

**实施顺序**：
1. 先拆 `user.admin.service.ts`（最大头）
2. 再拆 `channel.admin.service.ts`
3. 再拆 `billing.admin.service.ts`
4. 每拆一个跑一次 E2E admin-pages.spec

### 4.2 Controller 下沉 Prisma

三个文件一次性改完：

| 文件 | 违规方法 | 下沉到 |
|---|---|---|
| `user/user.controller.ts:80-121` | `getUsageStats()` aggregate + rawSQL | `user.repository.ts` 新增 `getUsageStats()` 方法，service 层调 |
| `apikey/apikey.controller.ts:29-43` | `getApiModels()` findMany modelPricing | `apikey.service.ts` 调 `rdclaw/model-pricing.service.ts` 的现有方法 |
| `billing/billing.controller.ts:91-96` | `getCurrentSubscription()` findUnique | `billing.service.ts` 调现有 `SubscriptionResolverService` |

**验收**：`grep -rn "PrismaService" apps/api/src/**/*.controller.ts` 返回空。

### 4.3 ILLMGateway 接口

**动机**：`chat.service.ts` 直接依赖 `RdclawService.forwardToUpstream()`，Chat 模块无法接第二个产品。

**接口设计**：

```typescript
// rdclaw/gateway/llm-gateway.interface.ts
export interface ILLMGateway {
  forward(req: ForwardRequest): Promise<ForwardResponse>;
  listModels(): Promise<ModelInfo[]>;
}

// rdclaw.service.ts
@Injectable()
export class RdclawService implements ILLMGateway { ... }

// chat.module.ts
providers: [
  ChatService,
  { provide: 'ILLMGateway', useClass: RdclawService },
]

// chat.service.ts
constructor(@Inject('ILLMGateway') private gateway: ILLMGateway) {}
```

**YAGNI 边界**：不现在抽第二个实现。接口定义 + RDClaw 实现 + Chat 依赖接口 = 足够。

### 4.4 integration/ 模块与可靠 Webhook

**新模块**：`apps/api/src/integration/`

**职责**：
- 所有对外 HTTP 调用（webhook、Sub2API 转发、支付 provider 回调）的防腐层
- BullMQ 任务队列（复用现有 Redis）
- 签名（HMAC-SHA256 + timestamp）+ 幂等键 + 重试策略

**文件结构**：
```
integration/
├── integration.module.ts
├── webhook/
│   ├── webhook.service.ts        // 统一发送入口
│   ├── webhook.processor.ts       // BullMQ worker
│   └── webhook.dto.ts
├── signing/
│   └── hmac.util.ts
└── queue/
    └── queue.config.ts
```

**迁移**：`sync.service.ts:119-148` 的 `notifyProductSaas` 改为入队 → processor 带重试发送。失败 3 次后进死信 + 告警。

**验收**：
- 压测 webhook：对方 500 的情况下，队列积压可见，3 次后进死信
- HMAC 签名验证（对方侧用 timestamp + body 验）
- 整合测试：kill webhook worker，重启后队列继续消费

### 4.5 单元测试补齐（并行补写）

按风险优先级：

| 顺序 | 模块 | 目标行数 | 关键场景 |
|---|---|---|---|
| 1 | `payment.service.spec.ts` | > 200 行 | createOrder / notifyPayment 幂等 / 回调验签 / 超时 / 退款回滚 |
| 2 | `credit.service.spec.ts` | > 150 行 | 并发扣减 / Lua 脚本分支 / 冷启动重算 / 超额保护 |
| 3 | `apikey.service.spec.ts` | > 100 行 | hash 存储 / rotate / soft delete / 外键 |
| 4 | `billing.service.spec.ts` | > 100 行 | 订阅激活 / 过期 / 免费套餐转换 / 流水 |
| 5 | Controller/Guard 补齐 | — | 未覆盖的 admin controller、jwt.strategy |

**覆盖率目标**：Phase 2 结束时整体 ≥ 60%，auth/payment/credit/apikey ≥ 90%。

### 4.6 Phase 2 验收
- [ ] `admin.service.ts` < 400 行
- [ ] `grep "PrismaService" *.controller.ts` 为空
- [ ] `ILLMGateway` 接口已定义，chat.service 依赖接口
- [ ] `integration/` 模块上线，webhook 走 BullMQ
- [ ] 整体覆盖率 ≥ 60%，核心金额模块 ≥ 90%
- [ ] E2E admin-pages 全绿

---

## 5. Phase 3 — 收口（4–6 周）

### 5.1 测试覆盖爬到 85%
- 补齐 channel / rdclaw / member / chat / sync 的 service spec
- E2E 补齐支付流程完整链路（含伪造 provider）
- 开启 `test-results/coverage-summary.json` 上报

### 5.2 CI Gate
- `.github/workflows/ci.yml` 增加：
  - `pnpm typecheck`（当前可能未启用 strict，先打开）
  - `pnpm test` 覆盖率 < 85% 阻断
  - `pnpm lint` 零 warning 阻断
  - `pnpm build` 必须通过
- PR 未过 gate 禁止 merge（GitHub branch protection）

### 5.3 前端类型收敛
- `apps/admin/src/api/admin.ts` 的 `Record<string, unknown>` 全部替换
- 用 `packages/shared` 已有的 Zod schema 生成 TS 类型
- tsconfig.json 开启 `strict: true`

### 5.4 存量数据对账
- 写一次性脚本 `scripts/audit-credit-integrity.ts`：
  - 对每用户 SUM(CreditTransaction.amount) vs CreditBalance.current
  - 找出 Admin 扣了但 codesphere-saas 没收到的记录（日志比对）
  - 输出修复建议报告
- 写入 `track/devlogs/` 作为审计证据

### 5.5 UI 7 页面评估
- 取出 stash，跑 visual regression（Playwright screenshot 对比）
- 有 regression → 回退
- 无 regression → 提交

### 5.6 Phase 3 验收
- [ ] CI gate 开启并生效（有 PR 被阻断过至少 1 次）
- [ ] 覆盖率 ≥ 85%
- [ ] `apps/admin/src/api/admin.ts` 零 `Record<string, unknown>`
- [ ] 对账脚本跑完，存量问题在 track/ 有记录
- [ ] UI 7 页面处置完毕

---

## 6. 风险与缓解

| 风险 | 可能性 | 影响 | 缓解 |
|---|---|---|---|
| Phase 1 并行 subagent 产生 merge 冲突 | 中 | 拖延 2–3 天 | 每个 subagent 用 worktree；主会话串行 merge；5 个 P0 之间文件几乎不重叠（admin.repository / channel.service / payment.service / main.ts / auth.service）已无冲突 |
| codesphere-saas 团队没空配合新 RPC | 中 | 计费不彻底解决 | Phase 1 新 RPC 先上，旧接口保留；对方迁移排期可以拖到 Phase 3 |
| PG commit 成功但 Redis 补偿失败（回滚场景）| 低 | Redis 余额与 PG 不一致 | 补偿失败写 alert + 后台 reconcile worker 每分钟对账 Redis vs PG 最新流水，偏差自动纠正 |
| AdminService 拆分破坏现有行为 | 中 | 管理端某功能失效 | 每拆一个 admin service 跑一次 e2e/admin-pages.spec；拆完 review 调用链 |
| 7 页面 UI stash 丢失 | 低 | 1512 行 UI 工作损失 | `git stash` 其实不会丢，而且有 reflog；同时建议 push 到 `feature/ui-refactor-parked` 分支备份 |
| 生产部署期间扣费迁移到新 RPC 时窗口数据丢失 | 中 | 少数请求扣费失败 | 灰度：新 RPC 上线后，codesphere-saas 先 5% 流量切到新 RPC，观察 1 天无异常再切 100% |

---

## 7. 分工与组织

### 主会话（PM）
- 用 TaskCreate 维护 Phase 1 / 2 / 3 的 TodoList
- 每个 Phase 结束写 devlog
- 更新 track/PROGRESS.md 和 track/DECISIONS.md
- 每次 subagent 归来跑 build/test 验证

### Subagent（并行开发）
- 严格白名单工具：Read、Edit、Write、Bash、Glob、Grep
- 每个任务给具体 文件:行 + 修复描述 + 验证命令
- 输出必须包含：diff 摘要 / 跑过的测试 / 下一步建议

### Codex（审查）
- 每个 P0 修复完成后 `/codex:review`（read-only 沙盒）
- 关键事务（outbox、idempotency）完成后 `/codex:adversarial-review`
- 失败超过 2 次用 `/codex:rescue`

### 用户
- Phase 切换关卡确认
- outbox/idempotency 方案的最终决策（Phase 1 中途还会再 check 一次）
- 生产部署的灰度时机

---

## 8. 不做清单（明确 YAGNI）

- 不拆 AdminController（924 行可以忍）
- 不抽第二个 ILLMGateway 实现
- 不引入 Kafka/RabbitMQ
- 不改业务表 schema（只修 drift）
- 不重写前端状态管理（Zustand/Redux 留到下一轮）
- 不做 i18n、Stripe 国际支付、沙箱环境（PROJECT-SPEC 的 P2+ 项目）

---

## 9. 关键文件清单

**Phase 1 会动的**：
- `apps/api/src/admin/admin.repository.ts`（P1-1）
- `apps/api/src/channel/channel.service.ts`、新增 `common/utils/url-guard.util.ts`（P1-2）
- `apps/api/src/payment/{wechat-pay,alipay,stripe}.service.ts`、`payment.service.ts`（P1-3）
- `apps/api/src/main.ts`、`common/pipes/zod-validation.pipe.ts`（P1-4）
- `apps/api/src/auth/auth.service.ts`（P1-5）
- `apps/api/src/billing/credit.service.ts`、`sync/sync.service.ts`、`prisma/schema.prisma`（新表 IdempotencyKey）（P1-6）

**Phase 2 会动的**：
- `apps/api/src/admin/admin.service.ts`、新增 `*/\*.admin.service.ts` 三个
- `apps/api/src/{user,apikey,billing}/*.controller.ts`
- `apps/api/src/rdclaw/gateway/llm-gateway.interface.ts`、`chat.module.ts`、`chat.service.ts`
- 新增 `apps/api/src/integration/`

**Phase 3 会动的**：
- `.github/workflows/ci.yml`
- `apps/admin/src/api/admin.ts`
- `apps/admin/tsconfig.json`
- 新增 `scripts/audit-credit-integrity.ts`

---

## 10. 下一步

本 spec 通过用户 review 后，进入 `superpowers:writing-plans` 为 Phase 1 生成详细实施计划（6 个 P0 任务 × 文件/测试/验证命令级别的 step）。Phase 2、Phase 3 的 plan 在各自 Phase 启动前再写，避免计划腐化。
