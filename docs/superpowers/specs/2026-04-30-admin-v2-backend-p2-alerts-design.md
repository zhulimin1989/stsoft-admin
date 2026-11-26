# Admin v2 Backend P2 Alerts(事件流) · Design Spec

- **Date**: 2026-04-30
- **Scope**: codesphere-admin-saas / apps/api(后端) + 已有 admin 前端 stub 接入
- **Owner**: 后端业务能力补全
- **Status**: Draft
- **Predecessor**: P0 4 件集成已部署 saas-test 验证 PASS
- **Next**: writing-plans

---

## 1. 背景

P1 admin v2 重构上线后,前端 `/alerts` 页面已写好,通过 `apps/admin/src/api/v2/alerts.ts` 调四个端点。**所有端点后端未实现** —— 列表返回 502/404,标已读/处理无效。

运营在 saas-test 上没有统一的"事件流"工作面:支付失败、渠道异常、风控判定都散落在各模块日志里,要靠开发团队从日志里捞、Slack 喊。Alerts 模块要把这些事件归口到一个**异步、可追踪、可过滤**的运营工作面。

### 1.1 命名注意:与 v0.3 既有 Alert 表区分

v0.3 时期已有一个 `alerts` 表,模型是 **告警规则配置**(name/metric/condition/threshold/windowMinutes),挂在 `/admin/monitoring/alerts` 下,前端 `Monitoring` 页在用。

本 P2 设计的是 **事件流**(category/severity/status/title/message/sourceId/...),概念完全不同。

**决策(详见 §10)**:
- 表名用 **`alert_events`**(避开 `alerts` 名字冲突)
- Prisma model 名用 **`AlertEvent`**(避开 `Alert` 名字冲突)
- 前端 endpoint 沿用 `/admin/v2/alerts`(前端已固定,改它会破坏前端)
- 内部代码层 service / controller 都用 `AlertEvent` 命名,只在 controller 路由上保持 `/alerts`

## 2. 目标

让 admin `/alerts` 页面真正生效,**运营人员有一个统一的事件中心**:

| # | 能力 | 现状 | P2 完成后 |
|---|---|---|---|
| 1 | Alert 数据模型 | ❌ 无 schema | Alert 表 + Severity/Category/Status 三个 enum |
| 2 | 事件源接入 | 各模块只 logger.error,运营看不到 | 4 类事件源生成 Alert(RiskEngine / 支付/渠道 / 用量阈值 / 系统健康占位) |
| 3 | 列表 + 过滤 | ❌ 无端点 | GET /admin/v2/alerts(分页 + category + severity + status + 时间范围) |
| 4 | 详情 + 处理 | ❌ 无端点 | GET /:id, POST /mark-read, POST /:id/handle(三态状态机) |
| 5 | 统计卡片 | 前端有 StatCardGroup 但拿不到数据 | API 返回未读/严重/今日 三个数 |

## 3. 非目标

- ❌ 不接入 Sentry / GlitchTip / Prometheus(系统健康源仅占位 stub,后续单独项目)
- ❌ 不实现外部告警路由(钉钉/企微/邮件/PagerDuty)
- ❌ 不做 alert 规则配置 UI(阈值用环境变量 + 代码常量,后续如需可视化再做 P3)
- ❌ 不实现 assignee 派发(每条 Alert 谁都能 mark-read / handle)
- ❌ 不实现 alert dismiss / escalate / 状态回退(状态严格单向)
- ❌ 不在本期把所有可能的事件源都接入(限定 §6 列出的具体 hook 点)

## 4. 红线

- 事件源接入**不阻断主链路** —— Alert 写入失败必须 catch + warn,不让 RiskFlag/支付/扣费回滚
- Alert 写入是**异步、附加**职责,主流程同步等待最多 50ms
- 不引入新 BullMQ job(本期不需要,事件源都是同步触发)
- 现有日志不删,Alert 是补充而非替代
- schema 改动只新增,不修现有表
- 列表查询必须有索引 + 分页上限 200/页(防 DoS)

---

## 5. PR 拆分

3 个独立 PR,按依赖顺序:

```
P2-A1  Alert schema + Service + Controller(CRUD/状态机)
       ↓
P2-A2  事件源接入:RiskEngine + 支付/渠道
       ↓ (独立,可与 A2 并行,但实施按 A2 先)
P2-A3  事件源接入:用量阈值 + 系统健康占位
```

每个 PR 独立 spec + quality 双 review,严格按 PR0 模式。

---

## 6. P2-A1: Alert schema + 基础 CRUD

### 6.1 Schema

```prisma
model AlertEvent {
  id          String              @id @default(uuid())
  category    AlertEventCategory
  severity    AlertEventSeverity
  status      AlertEventStatus    @default(PENDING)

  // 事件元数据(必填)
  title       String        // 简短摘要,前端列表展示
  message     String        // 详细描述,详情页 Drawer 展示

  // 关联实体(可选,按 category 不同来源)
  sourceType  String?       @map("source_type")      // 'risk_flag' | 'order' | 'channel' | 'user_usage' | 'system'
  sourceId    String?       @map("source_id")        // 关联记录的 id(RiskFlag.id / Order.id / Channel.id / userId / null)
  userId      String?       @map("user_id")          // 涉及用户(若有,用于按用户过滤)

  // 上下文 JSON(供详情页结构化展示 + 二次定位)
  context     String        @default("{}")           // JSON: {orderId, channelId, ruleId, threshold, value, ...}

  // 处理状态
  readAt      DateTime?     @map("read_at")
  handledAt   DateTime?     @map("handled_at")
  handledBy   String?       @map("handled_by")       // adminMember.id
  handleNote  String?       @map("handle_note")

  createdAt   DateTime      @default(now()) @map("created_at")
  updatedAt   DateTime      @updatedAt      @map("updated_at")

  // 反向关系
  user        User?         @relation(fields: [userId], references: [id], onDelete: SetNull)
  handler     AdminMember?  @relation("AlertEventHandler", fields: [handledBy], references: [id], onDelete: SetNull)

  @@index([category, status, createdAt(sort: Desc)])
  @@index([severity, status, createdAt(sort: Desc)])
  @@index([userId, createdAt(sort: Desc)])
  @@index([status, createdAt(sort: Desc)])
  @@map("alert_events")
}

enum AlertEventCategory {
  PAYMENT     // 支付失败 / Stripe 验签失败 / 退款异常
  CHANNEL     // 渠道 401 / refresh failed / 配额耗尽
  USAGE       // 用户用量超阈值
  SECURITY    // RiskEngine 生成的 RiskFlag
  SYSTEM      // 系统健康占位(本期仅 stub)
}

enum AlertEventSeverity {
  CRITICAL    // 阻断性,需立即处理
  HIGH        // 重要,小时级响应
  MEDIUM      // 一般,日级响应
  LOW         // 提示
}

enum AlertEventStatus {
  PENDING     // 未读(初始状态)
  READ        // 已读(运营查看过)
  HANDLED     // 已处理(写过 note)
}
```

User / AdminMember 反向关系:

```prisma
model User {
  // ...existing
  alertEvents AlertEvent[]
}

model AdminMember {
  // ...existing
  handledAlertEvents AlertEvent[] @relation("AlertEventHandler")
}
```

### 6.2 Service

`AlertEventService` 暴露(命名避开既有的 `AdminService.createAlert` 等告警规则方法):
- `createAlert(input)` — 内部 API,事件源调用
  - input: { category, severity, title, message, sourceType?, sourceId?, userId?, context? }
  - 失败仅 logger.warn,不抛
  - 去重:按 (category, sourceType, sourceId) 在最近 5 分钟内已有 PENDING/READ Alert 的话,**不重复创建**(避免事件源 burst 时 DB 被刷穿)
- `list(query)` — 分页 + 过滤
  - query: { page, pageSize, category?, severity?, status?, fromDate?, toDate?, userId?, q? }
  - q 模糊匹配 title + message
  - pageSize 上限 200
- `getById(id)` — 详情
- `markRead(ids: string[], adminId)` — 批量,PENDING → READ,只更 readAt(不更 status?)。本期决策:同时更 status='READ',readAt=now()。
- `handle(id, adminId, note)` — 单条 → HANDLED,handledAt/handledBy/handleNote
  - 校验:status 必须不是 HANDLED(幂等抛 BadRequest)
- `getStats()` — 三个数:unreadCount(PENDING)、criticalCount(severity=CRITICAL && status!=HANDLED)、todayCount(createdAt 在今日)

### 6.3 Controller

`AlertEventsController` + `@Controller('admin/v2/alerts')` + `AdminJwtAuthGuard, AdminPermissionGuard`

(controller 路径沿用 `/admin/v2/alerts` 与前端 contract 对齐;service / model 命名用 `AlertEvent` 避开既有 `Alert` 模型)

| 路由 | 权限 | 行为 |
|---|---|---|
| GET / | admin.audit.view | list |
| GET /stats | admin.audit.view | getStats |
| GET /:id | admin.audit.view | getById |
| POST /mark-read | admin.audit.manage | markRead |
| POST /:id/handle | admin.audit.manage | handle(body: { note }) |

权限沿用 audit.view/manage(Alerts 是审计相关),不新增权限原子。

### 6.4 测试

- service 单测:createAlert 去重、list 过滤组合、状态机转移幂等、handle 校验
- controller e2e 风格集成:auth + 权限 + 三种状态机操作

### 6.5 验证

- 在 admin DB 直接 INSERT 几条 Alert(category=PAYMENT, severity=HIGH 等)
- admin 前端 /alerts 页打开 → 列表展示 + 过滤生效 + 详情 + mark-read + handle 全过

---

## 7. P2-A2: 事件源接入(RiskEngine + 支付/渠道)

### 7.1 RiskEngine 钩子

文件:`apps/api/src/risk/risk-engine.service.ts` 内 RiskFlag 创建路径

```ts
// 现有逻辑创建 RiskFlag 后:
await this.alertService.createAlert({
  category: 'SECURITY',
  severity: this.riskActionToSeverity(rule.action),
  // BLOCK/FREEZE_USER → CRITICAL
  // DISABLE_KEY → HIGH
  // ALERT → MEDIUM
  title: `风控触发:${rule.name}`,
  message: `规则 ${rule.name}(${rule.ruleType}/${rule.action})命中用户 ${userId}`,
  sourceType: 'risk_flag',
  sourceId: flag.id,
  userId,
  context: { ruleId: rule.id, ruleType: rule.ruleType, matchedValue, action: rule.action },
});
```

去重(§6.2):同一规则、同一用户、5 分钟内已有 PENDING/READ Alert 不重建,避免 risk-engine 5 分钟 cron 反复打。

### 7.2 支付/渠道钩子

3 个具体接入点:

**a. fulfillOrder 失败**(`apps/api/src/payment/payment.service.ts`):
- catch 块里 createAlert(category='PAYMENT', severity='HIGH', sourceType='order', sourceId=orderId, userId, message=err.message, context={amountCents, channel, status})

**b. Stripe webhook 验签失败**(`apps/api/src/payment/payment.controller.ts` notify/stripe):
- 验签 throw 时 createAlert(category='PAYMENT', severity='CRITICAL', sourceType='order', sourceId=null, message='Stripe webhook signature verification failed', context={ip, headers...})

**c. Channel 401 / refresh failed**(`apps/api/src/channel/channel.service.ts`):
- channel 健康检查或 token refresh 失败时 createAlert(category='CHANNEL', severity='CRITICAL', sourceType='channel', sourceId=channelId, message=`渠道 ${name} 鉴权失败:${err.message}`)
- 去重:同一 channelId 5 分钟内不重建

### 7.3 测试

每个 hook 一个集成测试:
- 模拟事件触发 → 验证 Alert 写入 + 字段正确
- AlertService.createAlert mock throw → 验证主流程不回滚

### 7.4 风险与缓解

| 风险 | 缓解 |
|---|---|
| risk-engine 高频 hit 把 Alert 表刷大 | 去重窗口 + 主流程不阻塞 |
| Stripe 攻击导致 CRITICAL alert 雪崩 | 同 sourceType=order, sourceId=null 也走去重(同 IP 5 分钟内只一条) |
| AlertService 失败拖垮 fulfillOrder | createAlert 内部全 catch,只 warn 不抛 |

---

## 8. P2-A3: 事件源接入(用量阈值 + 系统健康占位)

### 8.1 用量阈值

定义阈值常量:
- 单用户单产品**单日 token 消费** > `USAGE_DAILY_TOKEN_THRESHOLD`(默认 1_000_000)→ severity=MEDIUM
- 单用户**单小时 deduct 调用次数** > `USAGE_HOURLY_CALL_THRESHOLD`(默认 1000)→ severity=HIGH

接入位置:`CreditService.deduct` 成功后异步检查(不阻断扣费)
- 用 setImmediate 解耦
- 失败完全 swallow(包括 Alert 写入失败)

去重:同 userId + 同 metric + 24h 内不重建。

### 8.2 系统健康(占位)

只搭框架,不接真实监控:

```ts
// AlertService.createSystemAlert(metric, value, threshold)
// — 暴露给后续 Sentry / Prometheus 集成调用
// — 本期没人调用,但 controller 端能查 category=SYSTEM 的列表
```

可在 health.controller.ts 的 ready check 里**示例性**接入一次(Redis ping fail):
- redis ping 抛错时 createAlert(category='SYSTEM', severity='CRITICAL')
- 限频 5 分钟去重

### 8.3 测试

- 用量阈值:模拟 deduct 多次堆叠,验证超阈值生成 Alert,未超不生成
- 系统健康:redis mock throw,验证 Alert 写入

---

## 9. 测试覆盖与发布

每个 PR 至少:
- 1 个集成测试(setup → mutate → assert end-to-end)
- 单元测试覆盖关键边界(去重、状态机、权限)

发布顺序:
1. P2-A1 部署 saas-test → admin /alerts 页能进、空列表 → seed 几条 Alert 验证 UI 全过
2. P2-A2 部署 → 触发支付失败 / 风控规则 → 看 Alert 自动生成
3. P2-A3 部署 → 触发高频扣费 → 看用量 Alert 生成

---

## 10. 决策记录

| 决策 | 结论 | 理由 |
|---|---|---|
| 表名 / 模型名 | alert_events / AlertEvent(避开既有 alerts / Alert) | v0.3 alerts 表是告警规则配置(name/metric/condition/threshold/windowMinutes),与本期事件流概念完全不同。共用同表会造成字段污染 + 双语义 service。改名后两者独立演进 |
| 前端 endpoint | 沿用 /admin/v2/alerts | 前端 stub(apps/admin/src/api/v2/alerts.ts)已固定,后端 controller 路径与表名脱钩没问题 |
| 状态机是否支持回退/dismiss/escalate | 否,严格 PENDING→READ→HANDLED 单向 | 简化模型,运营场景实际不复杂 |
| 是否支持 assignee 派发 | 否 | adminMember 数量小,大家都看,派发是过设计 |
| 系统健康源是否本期接 Sentry | 否,仅占位 | Sentry 集成是独立项目,Alerts 框架先就绪 |
| AlertEvent.context 结构化 vs JSON 字符串 | JSON 字符串(String + JSON.stringify) | Prisma 不支持 native JSONB schema-less 灵活;前端按 category 知道字段,字符串足够 |
| 阈值规则配置:UI 还是 env/常量 | 本期 env+常量,后续 P3 可视化 | 阈值变更频率低,先跑通再迭代 |
| 去重窗口长度 | 5 分钟(category 内 sourceType+sourceId) | 平衡:避免雪崩 + 不漏报真实多次事件 |

---

## 11. 后续工作(P3 候选)

- Alert 路由到外部(钉钉/企微/邮件 webhook)
- Alert 规则可视化配置(阈值、去重窗口、严重度映射)
- Alert assignee + SLA(类似 Ticket)
- Sentry 真实接入填充 SYSTEM category
- Alert 关联到现有 Ticket(若 Alert 升级为客诉)

---

## End of Spec
