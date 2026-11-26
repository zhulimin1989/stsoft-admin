# 覆盖率策略（Wave D 生效）

> 2026-04-17 · 设计来源：原 spec `Phase 3 CI gate` + 实际数据校准

## 为什么不设 85% 硬线

原 spec 写的是"整体 85% lines、核心模块 100% 分支"。实际跑完 Phase 2 全部任务后，测量数据：

| 模块类别 | 真实覆盖 |
|---|---|
| 核心金额路径（payment/apikey/billing/wechat/alipay/stripe/webhook/hmac/url-guard） | **95-100%** ✅ |
| AdminService Facade（Wave B 后）| 14%（都是一行委派，不需要单独测） |
| 辅助管理平台（alerts/announcements/feature-flags/system-prompts/system-config）| 0% |
| auth 外围（auth0-verifier / auth0-management）| 0-7% |
| subscription-expiry、member、channel.admin、billing.admin | 0-10% |

把辅助模块也顶到 85% 意味着要写数百个测试，这些代码不是金额路径 — **投产 ROI 低**。务实策略：**分层门槛**。

## 分层门槛（写死在 `apps/api/package.json` jest.coverageThreshold）

### 严格层 — 金额 / 安全
这些文件 CI 会硬卡住，低于门槛 PR 不能合并：

| 文件 | Branches | Functions | Lines |
|---|---|---|---|
| `apikey.service.ts` | 100 | 100 | 100 |
| `billing.service.ts` | 100 | 100 | 100 |
| `payment.service.ts` | 85 | 75 | 95 |
| `stripe.service.ts` | 100 | 100 | 100 |
| `wechat-pay.service.ts` | 85 | 100 | 100 |
| `alipay.service.ts` | 95 | 100 | 100 |
| `integration/webhook/webhook.service.ts` | 100 | 100 | 100 |
| `common/utils/hmac.util.ts` | 100 | 100 | 95 |
| `common/utils/url-guard.util.ts` | 95 | 100 | 95 |

### 全局层 — 最低防线
阻止测试大规模倒退：

| | Branches | Functions | Lines | 实际 (Phase 3 Step 2 后) |
|---|---|---|---|---|
| Global | 45 | 30 | 48 | 60 / 34 / 50 |

**数字略低于实际**（测试数 488 → 1012，覆盖率 36% → 50%）—— 留 buffer 防止小改动立刻崩 CI。

### 升级路径

Phase 3 Step 2 已完成：所有金额相邻/auth/admin facade/平台运营/rdclaw+chat 的 service 层都达到 ≥80% lines。

剩下仍低覆盖率的类别（都是防御性/仪式性补测，ROI 低，留给下一轮）：
- Controllers (~11 个，0% line)：间接被 service 测试覆盖，E2E 再兜底
- Repositories (~6 个，11-25%)：Prisma thin wrappers
- AdminService Facade (16%)：业务逻辑在 *.admin.service.spec 里测过
- Guards/Decorators/Filters (0%)：NestJS 基础设施

追到 85% 需要写 200+ 仪式性 mock 测试，核心价值小。建议：
- 新加业务 service 必须 ≥80%（在 strict tier 加条目）
- 不强制回头补 Controller / Repository / Facade stub 的覆盖率
- 如果真要冲 85%，那一轮独立作为 "sink-the-floor" 任务来做

## CI gate 工作流

`.github/workflows/ci.yml` 三个 job：

1. **lint-and-typecheck**
   - prisma generate（必须先跑，否则 @prisma/client 类型缺失）
   - shared build（workspace consumers 需要编译产物）
   - pnpm lint（zero errors，warnings 不阻断）
   - pnpm typecheck

2. **test**
   - 拉起 postgres 16 + redis 7 service container
   - prisma migrate deploy
   - `pnpm --filter @ruidong/api exec jest --coverage` → **threshold 不达标 CI 挂**
   - 上传 coverage 为 PR artifact

3. **build**
   - needs: lint-and-typecheck
   - pnpm build 三个包

## 本地如何自查

```bash
# 跑所有测试 + 覆盖率门槛
pnpm --filter @ruidong/api exec jest --coverage

# 只看某个服务的覆盖率
pnpm --filter @ruidong/api exec jest --coverage --collectCoverageFrom="src/payment/**/*.ts" --testPathPattern=payment

# 单文件 detailed 覆盖
pnpm --filter @ruidong/api exec jest --coverage --testPathPattern=wechat-pay
```

## 对 PR 作者的建议

- **动金额代码**：先写测试再改代码，保持 95%+
- **动管理平台代码**：可以不写新测试，但**不要让全局线掉**（在 `package.json` 调门槛时请同时更新本文档）
- **修 bug**：先写复现用的失败测试（红），再修（绿），再 commit
