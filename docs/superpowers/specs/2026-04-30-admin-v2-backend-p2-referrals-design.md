# Admin v2 Backend P2 Referrals · Design Spec

- **Date**: 2026-05-01
- **Scope**: codesphere-admin-saas / apps/api(后端) + 已有 admin 前端 stub 接入
- **Owner**: 后端业务能力补全
- **Status**: Draft
- **Predecessor**: P2 Alerts/Funnel/CreditPolicy 已部署 saas-test
- **Next**: writing-plans

---

## 1. 背景

P1 admin v2 重构上线后,前端 `/referrals` 页面已写好,通过 `apps/admin/src/api/v2/referrals.ts` 调五个端点(programs CRUD + redemptions + leaderboard)。**所有端点后端未实现**,前端 stub 模式只展示骨架。

业务诉求:邀请裂变是 SaaS 增长的关键玩法。运营需要配置不同奖励 program(注册/首充/首订),每个推荐人发出唯一邀请码,被邀请用户注册时归因,触发条件达成时发奖励给推荐人 + 被邀请人(双向)。同时需要防作弊:同 IP/同设备限购,单用户邀请上限。

## 2. 目标

| # | 端点 | 现状 | P2-D 完成后 |
|---|---|---|---|
| 1 | `GET /admin/v2/referrals/programs` | ❌ | 列所有 program(含已停用) |
| 2 | `POST /admin/v2/referrals/programs` | ❌ | 创建 program |
| 3 | `PUT /admin/v2/referrals/programs/:id` | ❌ | 更新 program |
| 4 | `DELETE /admin/v2/referrals/programs/:id` | ❌ | 软删 |
| 5 | `GET /admin/v2/referrals/redemptions` | ❌ | 列归因记录,可按 programId 过滤 |
| 6 | `GET /admin/v2/referrals/leaderboard` | ❌ | 推荐人排行榜(按 inviteCount + rewardTotal) |

后端附加:
- 注册流程接入归因(`/auth/register` body 接受 `referralCode`,匹配后写 ReferralRedemption)
- 触发条件达成时发奖励给推荐人 + 被邀请人(联 GrantRule:每 program 创建时同步 hidden GrantRule,触发时调 grant-executor.grantToUser)
- 用户拿自己的 referralCode(`/user/referral-code` GET 接口)

## 3. 非目标

- ❌ 不做用户端的邀请落地页 / 二维码 / 邀请链接生成 UI(前端工作)
- ❌ 不做 cohort 留存分析 / 收益归因(只统计触发 + 奖励)
- ❌ 不做实时推送(redemptions 列表轮询查)
- ❌ 不接外部分销平台(留 P3)
- ❌ 不实现"奖励多级"(只双向:inviter + invitee,不传第二级 / 第三级)
- ❌ 不实现 Referral Program 的复杂奖励规则(如阶梯、门槛后倍数),只支持固定 inviterReward / inviteeReward 数值

## 4. 红线

- 注册主链路接入归因 hook,**性能影响 <50ms**(referralCode 命中查 DB 一次,异步触发奖励)
- 注册主链路绝对**不阻塞** —— 归因失败 / 奖励失败仅 logger.warn
- 防作弊检查在 ReferralRedemption 写入前做,但**不阻塞用户注册**(归因失败仍允许注册,只是不计奖励)
- 不引入新 BullMQ
- 不修改既有 GrantRule 现有运行(本期只新建 hidden GrantRule)

---

## 5. 单 PR 实施

P2-D 一个 PR 完成:Schema(3 表)+ Service + Controller + Auth.register hook + 测试。Module 挂入 AppModule。

工作量比 Alerts/Funnel/CreditPolicy 大,但仍单 PR 闭环。

---

## 6. Schema

### 6.1 ReferralProgram(运营配置)

```prisma
model ReferralProgram {
  id                    String                       @id @default(uuid())
  name                  String
  inviterReward         Int                          @map("inviter_reward")  // 推荐人奖励(分,RMB 或 token credits)
  inviteeReward         Int                          @map("invitee_reward")  // 被推荐人奖励
  rewardCondition       ReferralRewardCondition      @map("reward_condition")
  productId             String?                      @map("product_id")  // 限定产品(可选)
  isActive              Boolean    @default(true)    @map("is_active")
  startAt               DateTime?                    @map("start_at")
  endAt                 DateTime?                    @map("end_at")

  // 防作弊
  sameIpLimit           Int?                         @map("same_ip_limit")        // 同 IP 在该 program 中最多被多少 inviter 拿到奖
  sameDeviceLimit       Int?                         @map("same_device_limit")
  perUserInviteLimit    Int?                         @map("per_user_invite_limit")  // 单 inviter 上限

  // 关联(每 program 同步创建 GrantRule 用于实际发奖)
  inviterGrantRuleId    String?                      @map("inviter_grant_rule_id")
  inviteeGrantRuleId    String?                      @map("invitee_grant_rule_id")

  createdAt             DateTime   @default(now())   @map("created_at")
  updatedAt             DateTime   @updatedAt        @map("updated_at")
  deletedAt             DateTime?                    @map("deleted_at")

  redemptions           ReferralRedemption[]
  codes                 ReferralCode[]

  @@index([isActive, deletedAt])
  @@map("referral_programs")
}

enum ReferralRewardCondition {
  REGISTER          // 注册即触发
  FIRST_RECHARGE    // 首次充值(RECHARGE Order COMPLETED)触发
  FIRST_SUBSCRIBE   // 首次订阅(SUBSCRIPTION Order COMPLETED)触发
}
```

### 6.2 ReferralCode(每用户邀请码)

```prisma
model ReferralCode {
  id            String           @id @default(uuid())
  programId     String           @map("program_id")
  inviterUserId String           @map("inviter_user_id")
  code          String           @unique  // 8 位 BASE32 随机
  isActive      Boolean  @default(true) @map("is_active")
  createdAt     DateTime @default(now()) @map("created_at")

  program       ReferralProgram  @relation(fields: [programId], references: [id], onDelete: Cascade)
  inviter       User             @relation(fields: [inviterUserId], references: [id], onDelete: Cascade)

  @@unique([programId, inviterUserId])  // 每用户每 program 一个 code
  @@index([inviterUserId])
  @@map("referral_codes")
}
```

### 6.3 ReferralRedemption(归因记录)

```prisma
model ReferralRedemption {
  id              String                   @id @default(uuid())
  programId       String                   @map("program_id")
  codeId          String                   @map("code_id")
  inviterUserId   String                   @map("inviter_user_id")
  inviteeUserId   String                   @map("invitee_user_id")
  triggeredAt     DateTime?                @map("triggered_at")  // 触发条件达成时间(REGISTER 即注册时,FIRST_RECHARGE 在订单完成时)
  rewardGranted   Boolean      @default(false) @map("reward_granted")
  inviterIp       String?                  @map("inviter_ip")
  inviteeIp       String?                  @map("invitee_ip")
  inviteeDeviceId String?                  @map("invitee_device_id")  // 前端 localStorage 注入(可选)
  rejectReason    String?                  @map("reject_reason")  // 防作弊命中原因(本期写入但不发奖)
  createdAt       DateTime     @default(now()) @map("created_at")

  program         ReferralProgram          @relation(fields: [programId], references: [id], onDelete: Cascade)
  inviter         User                     @relation("InviterRedemptions", fields: [inviterUserId], references: [id], onDelete: Cascade)
  invitee         User                     @relation("InviteeRedemptions", fields: [inviteeUserId], references: [id], onDelete: Cascade)

  @@unique([programId, inviteeUserId])  // 同一 program 同一被邀请人只一条
  @@index([programId, triggeredAt])
  @@index([inviterUserId])
  @@map("referral_redemptions")
}
```

### 6.4 反向关系

```prisma
model User {
  // ...
  referralCodes        ReferralCode[]
  inviterRedemptions   ReferralRedemption[] @relation("InviterRedemptions")
  inviteeRedemptions   ReferralRedemption[] @relation("InviteeRedemptions")
}
```

## 7. Service

### 7.1 ReferralsService(`apps/api/src/referrals/referrals.service.ts`)

#### Admin CRUD
- `listPrograms()` — 含已软删?默认不含 deletedAt
- `createProgram(data)`:
  - upsert ReferralProgram
  - **同步创建 2 条 hidden GrantRule**(inviterGrantRuleId / inviteeGrantRuleId)
    - 命名约定:`__referral:program-{id}:inviter` / `:invitee`
    - triggerType=`MANUAL`(避免被自动 cron 扫到)
    - rewardType=BALANCE 若 productId 有 / CREDIT 若无
    - segmentId=null
- `updateProgram(id, data)`:更 program;若 inviterReward / inviteeReward / productId 变化,同步更新两条 GrantRule
- `deleteProgram(id)`:软删 ReferralProgram + 软删两条 GrantRule(级联 isActive=false)

#### 用户端
- `getMyReferralCode(userId, programId?)`:返回用户在指定 program(默认第一个 active)的 code,**不存在则懒生成**(8 位 BASE32 随机,DB unique 重试 3 次)

#### 注册归因 hook
- `attribute({ inviteeUserId, referralCode, inviteeIp, deviceId })`:
  - findFirst ReferralCode WHERE code=? AND isActive=true,带 program(active + 时间窗口)
  - 找不到 → 静默返(归因失败,但不影响注册)
  - 自归因检查:inviterUserId === inviteeUserId → reject
  - 防作弊检查(spec §8):sameIpLimit / sameDeviceLimit / perUserInviteLimit
    - 任一命中 → ReferralRedemption rejectReason=... rewardGranted=false 写入
    - 全过 → ReferralRedemption 写入(triggeredAt 仅 REGISTER 条件设为 now,其他 condition 留 null 等触发)
  - REGISTER 条件:同步触发 grant-executor.grantToUser inviter + invitee
  - 全部 fire-and-forget(失败仅 warn)

#### 触发回调
- `onOrderCompleted({ orderId })` — 由 PaymentService.fulfillOrder 调用:
  - 找该用户(invitee)的 ReferralRedemption WHERE triggeredAt is null AND rewardGranted=false
  - 检查 program.rewardCondition:
    - FIRST_RECHARGE && order.orderType=RECHARGE → 触发
    - FIRST_SUBSCRIBE && order.orderType=SUBSCRIPTION → 触发
  - 触发:redemption.update triggeredAt=now,grantToUser inviter + invitee,redemption.update rewardGranted=true

#### 列表
- `listRedemptions(opts)`:分页 + programId 过滤,join inviter.email + invitee.email
- `leaderboard(opts)`:GROUP BY inviterUserId 统计 inviteCount + rewardTotal,join email

### 7.2 防作弊算法(spec §8)

每条新 redemption 写入前:

1. **sameIpLimit**(若 program.sameIpLimit 非 null):
   - count `ReferralRedemption WHERE programId=? AND (inviteeIp=? OR inviterIp=?) AND rewardGranted=true`
   - >= sameIpLimit → reject(reason='SAME_IP_LIMIT')

2. **sameDeviceLimit**(若 program.sameDeviceLimit 非 null):
   - count `ReferralRedemption WHERE programId=? AND inviteeDeviceId=? AND rewardGranted=true`
   - >= sameDeviceLimit → reject

3. **perUserInviteLimit**(若 program.perUserInviteLimit 非 null):
   - count `ReferralRedemption WHERE programId=? AND inviterUserId=? AND rewardGranted=true`
   - >= perUserInviteLimit → reject

任一命中 → 写 redemption rejectReason=<rule>,但**不发奖**。redemption 仍写入便于运营追溯。

### 7.3 grant-executor 集成

ReferralsService 不直接调 BillingService / CreditService,而是用现有 GrantRule 体系:
- 创建 program 时同步创建 2 条 hidden GrantRule(triggerType=MANUAL,segmentId=null,name=`__referral:program-{id}:inviter` / `:invitee`)
- 触发奖励时:
  - `grantExecutor.grantToUser(inviterRule, inviterUserId, { manualTrigger: true })`
  - `grantExecutor.grantToUser(inviteeRule, inviteeUserId, { manualTrigger: true })`
- 这样:
  - inviter / invitee 的奖励逻辑统一走 grant 池(BALANCE / CREDIT)
  - 复用现有过期 / 限额 / 流水机制
  - 运营在 admin /grant-rules 也能看到 hidden 规则(以 `__referral:` 前缀过滤掉,前端 stub 不显示这些)

### 7.4 Cache

referralCode 查询热路径(注册时)— 加 60s Redis cache `referral:code:{code}` → JSON {programId, inviterUserId},失败 fallthrough 走 DB。

## 8. Controller

`@Controller('admin/v2/referrals')` + Guards

| 路由 | 权限 | 行为 |
|---|---|---|
| GET /programs | admin.promo.manage | listPrograms |
| POST /programs | admin.promo.manage | createProgram |
| PUT /programs/:id | admin.promo.manage | updateProgram |
| DELETE /programs/:id | admin.promo.manage | deleteProgram |
| GET /redemptions | admin.promo.manage | listRedemptions |
| GET /leaderboard | admin.promo.manage | leaderboard |

**用户端**(放 user 模块或新 referrals/user-controller):
| GET /api/user/referral-code?programId= | 已登录 | getMyReferralCode |

权限沿用 admin.promo.manage(邀请裂变是营销子项)。

## 9. Auth.register hook

`AuthService.register` 改:
- DTO 加可选 `referralCode?: string` + 可选 `deviceId?: string`(前端 localStorage 注入)
- 创建 user 后:
  - `referralsService.attribute({ inviteeUserId, referralCode, inviteeIp:req.ip, deviceId }).catch(() => {})` — fire-and-forget
- 不影响注册返回值

`PaymentService.fulfillOrder` 在 RECHARGE / SUBSCRIPTION 完成路径:
- `referralsService.onOrderCompleted({ orderId }).catch(() => {})` — fire-and-forget

## 10. 测试

- `referrals.service.spec.ts`:
  - createProgram 同步创建 2 GrantRule
  - getMyReferralCode 懒生成 + 唯一性重试
  - attribute 找不到 code → 静默
  - attribute 自归因 → reject
  - attribute 防作弊三种命中 → reject reason 写入
  - attribute REGISTER 条件 → 同步触发奖励
  - attribute FIRST_RECHARGE 条件 → 不触发,等 onOrderCompleted
  - onOrderCompleted RECHARGE → 触发未触发的 redemption
  - onOrderCompleted SUBSCRIPTION → 同
  - leaderboard 正确聚合
- `referrals.controller.spec.ts`:6 路由权限 metadata + happy path
- `auth.service.spec.ts`:补 register 接 referralCode 测试(代码层面注入 referralsService)

## 11. 决策记录

| 决策 | 结论 | 理由 |
|---|---|---|
| 邀请码生成 | 8 位 BASE32 random,user 级懒生成 | 用户友好,8 位 32^8 = 1.1T 空间 |
| 奖励发放 | 复用 GrantRule(hidden) | 不重复实现 grant 逻辑,共享过期/限额机制 |
| 防作弊 3 种 | 全实现 | 商业拉新真有作弊,本期一次到位 |
| 归因失败注册仍成功 | 是 | 主链路不阻塞,运营事后查 |
| FIRST_RECHARGE 触发 | PaymentService.fulfillOrder hook | 入口最准,不依赖 BullMQ |
| 邀请码 cache | 60s | 平衡:注册热路径快 + 失活后 60s 内可能仍命中(无害) |
| 多级邀请 | 否,只双向(inviter+invitee) | 多级风险 + 复杂度 |
| GrantRule MANUAL trigger | 是,避免被 cron 扫 | hidden 规则不应自动触发 |
| 软删 program | 软删 + 级联 GrantRule isActive=false | 历史数据可查,但不再发奖 |
| 用户端获取 code 路由 | /api/user/referral-code | 现有 /api/user 命名空间 |

---

## 12. 后续工作(P3 候选)

- 多级邀请(2 级 / 3 级)
- 时间窗口奖励倍数(限时活动)
- 邀请落地页生成 / 二维码 / 短链
- cohort 留存(归因用户的留存率)
- 收益归因(LTV 贡献)
- 接外部分销平台

---

## End of Spec
