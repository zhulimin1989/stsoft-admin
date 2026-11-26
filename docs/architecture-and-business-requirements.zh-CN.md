# codesphere-admin 技术架构与业务需求说明

本文档基于 `origin/test` 分支截至 2026-06-22 的代码现状整理，覆盖 `codesphere-admin` 仓库的技术架构、运行边界和业务需求。

## 1. 仓库定位

`codesphere-admin` 是内部运营后台仓库，面向公司内部运营、财务、产品、风控、客服和系统管理员。它不是用户门户，也不是计费核心服务；它提供后台 UI、后台登录/权限体系，以及面向 `codesphere-user`、`codesphere-billing` 的受控管理入口。

本仓库拥有：

- `apps/admin`：React/Vite 管理端前端。
- `apps/api`：NestJS/Fastify 管理 API，生产入口为 `dist/admin-main.js`。
- `packages/shared`：前后端共享的类型、Zod schema 和错误码。
- `apps/api/prisma/admin`：后台控制平面数据库 schema、迁移和生产 bootstrap。

本仓库不拥有：

- 用户身份库 `ruidong_console`。用户域读写必须通过 `USER_SERVICE_URL` 调用 user internal API。
- 计费库 `ruidong_billing`。计费、支付、账务、产品套餐、渠道和模型定价必须通过 `BILLING_SERVICE_URL` / `BILLING_PORTAL_SERVICE_URL` 调用 billing API。
- Gateway / Publisher 的真实运行时状态。后台只能经 billing/admin 内部接口查看、配置或触发同步。

## 2. 技术架构

### 2.1 总体形态

仓库采用 pnpm workspace：

- 根目录脚本负责编排 shared 构建、Prisma 生成、API 构建、前端构建、测试和数据库边界检查。
- `apps/api` 是 NestJS 11 服务，使用 Fastify 适配器、Prisma、Redis、JWT、Pino、Sentry、Prometheus metrics 和 Swagger。
- `apps/admin` 是 React 19 + Vite + Ant Design 5 管理后台，使用 React Router、Zustand、i18next、Recharts、Sentry。
- `packages/shared` 使用 TypeScript 输出共享 contracts，供 API 和前端引用。

### 2.2 API 运行时

管理 API 的入口是 `apps/api/src/admin-main.ts`：

- 启动前执行 `instrument.ts` 初始化 Sentry/OpenTelemetry。
- 设置 `RUIDONG_SERVICE=admin-api`。
- 使用 Fastify，开启 `trustProxy`、4MB body limit、120 秒请求超时和 72 秒 keep-alive。
- 注册 cookie、Helmet/rate-limit 等安全插件。
- 注册 runtime plane guard，限制服务以 `admin` 平面运行。
- 全局前缀为 `/api`，URI versioning 前缀为 `/v`。
- 非生产环境暴露 Swagger：`/api/docs`。
- 默认监听 `ADMIN_PORT` 或 `3001`。

主模块 `AppModule` 装配以下能力：

- `PrismaModule`：连接后台控制平面数据库。
- `RedisModule`：缓存、限流和安全插件依赖。
- `BillingProxyModule`、`BillingClientModule`：代理或调用 billing。
- `UserInternalClientModule`：调用 user internal API。
- `AdminModule`：后台登录、角色、成员、审计、聚合管理接口。
- `RechargeTiersModule`、`UserSegmentsModule`、`TicketsModule`、`RiskModule`、`QuotaTemplatesModule`、`CampaignModule`、`CreditGrantsModule`、`CreditPolicyModule`、`FunnelModule`、`AlertEventsModule`：后台 v2 运营域控制器。
- `MetricsModule`：Prometheus 指标接口。
- `HttpExceptionFilter`：统一错误响应。
- `AdminRequestContextInterceptor`：提取并传递管理员上下文。

### 2.3 前端架构

`apps/admin` 是单页管理后台：

- `app.tsx` 定义路由，登录页外其余页面在 `AdminLayout` 内运行。
- 页面使用 lazy chunk 加载，并通过 `lazyWithChunkReload` 处理前端部署后旧 chunk 失效。
- `AdminLayout` 统一提供左侧菜单、菜单搜索、权限过滤、路由预加载和退出登录。
- `ProductContext` / `PlatformConfigContext` 提供产品和平台配置上下文。
- `auth-store` 保存管理员登录态、权限和刷新逻辑。
- API 调用集中在 `src/api/admin.ts`、`src/api/axios.ts` 和 `src/api/v2/*`。

前端菜单按业务域分组：

- 运营总览：运营总览、业务漏斗。
- 用户运营：用户管理、用户分群、工单中心。
- 风控：风险用户、风控规则。
- 产品管理：产品列表。
- 订阅运营：套餐管理、加油包、订阅账号。
- 按量运营：按量定价、用量折扣策略、充值面额、信用额度、按量账号。
- CodingPlan：自营套餐、配额模板、三方套餐、转售配置、转售报表。
- 营销：组合套餐、限时活动、促销码、积分发放规则、邀请裂变、公告通知。
- 供给与渠道：模型库、供应商成本、供应商管理、投放设置、Publisher 同步。
- 财务中心：订单管理、Gateway 入账、财务报表、支付配置。
- 监控告警：实时监控、告警中心、Agent 观测。
- 系统：角色权限、后台账号、审计日志、功能开关、系统提示词、系统设置。

### 2.4 数据所有权

后台 API 只拥有 `ADMIN_DATABASE_URL` 对应的 `ruidong_admin`：

- 后台账号与权限：`AdminRole`、`AdminMember`。
- 后台操作审计：`AuditLog`、`AdminActivityLog`。
- 运营控制面配置：`Announcement`、`FeatureFlag`、`SystemPrompt`、`SystemConfig`。
- 后台告警配置与事件流：`Alert`、`AlertEvent`。

`PrismaService` 在生产环境强制要求 `ADMIN_DATABASE_URL`。`scripts/check-db-boundaries.mjs` 会禁止 admin-api 引入 billing/user 数据库 URL、禁止直接构造跨库 PrismaClient、禁止加入计费/支付/Kafka/KMS 等 billing runtime 依赖。

### 2.5 跨服务调用

admin-api 的跨服务调用分为两类：

- 调 user：`UserInternalClient` 调用 `USER_SERVICE_URL`，默认路径为 `/api/internal/user/admin`。请求携带 `x-internal-caller=admin-api`、调用方 token、内部 API 版本，以及短 TTL 的签名管理员上下文。user 侧按调用方、token、版本、路由范围和转发权限校验。
- 调 billing：`BillingInternalClient` 调用 `BILLING_SERVICE_URL`，默认路径为 `/api/internal/billing/admin`。请求同样携带内部调用方、token、版本和签名管理员上下文。billing 侧按 caller 白名单限制 admin-api 只能访问 internal billing admin 路由。

billing 查询代理接口由 `BillingPortalClient` 代理到 billing 公共 API，例如计划、余额、订阅、交易、积分、产品和导出。代理会转发 cookie、Authorization、origin、referer、user-agent 和 forwarded headers。

### 2.6 权限与安全

后台安全模型包括：

- 独立后台登录态：`admin_access_token` cookie，JWT 15 分钟有效期。
- 角色与权限：`AdminRole` 持有权限集合，`AdminMember` 绑定角色/预置角色/激活状态。
- 路由权限：前端 `permissions.ts` 和后端 `AdminPermissionGuard` 双层控制。
- CSRF/Origin 校验：状态变更请求必须来自允许的 CORS origin。
- 生产 secret 校验：`assertProductionSecrets` 阻止占位 secret 上线。
- Metrics 保护：`METRICS_USER` / `METRICS_PASSWORD`。
- 公司内网/VPN/访问代理暴露原则：README 明确 admin frontend 只能在内部访问面。

### 2.7 可观测与部署

- API 使用 `nestjs-pino` 输出结构化日志。
- Sentry 同时覆盖 API 和前端。
- `/api/health/live`、`/api/health/ready` 和 `/api/health` 提供健康检查。
- `/api/metrics` 提供 Prometheus 指标。
- Dockerfile 分为 API 和 Web，另有 China 变体。
- `deploy/nginx.conf` 用于前端静态资源部署。
- 生产迁移入口：`pnpm db:migrate:prod`。
- 生产 bootstrap：`pnpm db:bootstrap:prod`，只在显式提供 bootstrap 邮箱和密码/哈希时创建 super admin。

## 3. 业务需求

### 3.1 后台用户与权限管理

后台需要支持内部管理员登录、刷新、退出和查看 profile。管理员可以管理角色、后台账号、邀请成员、重置密码、强制退出和停用成员。所有敏感操作需要进入审计日志。

核心需求：

- 角色权限可配置，页面和接口都要做权限校验。
- 管理员上下文必须能跨服务传递，便于 user/billing 侧审计真实操作者。
- 后台账号体系与普通用户账号体系隔离。

### 3.2 用户运营

后台需要查看、搜索和管理注册用户，支持用户详情页聚合展示身份、订阅、API Key、审计日志、余额/积分/账务概况。对用户状态的变更、封禁、解封、重置密码等操作经 user internal API 完成。

核心需求：

- admin 不能直连用户库。
- 用户明细和身份配置由 user 服务返回。
- 管理操作必须带管理员身份和权限上下文。

### 3.3 计费、订阅与按量运营

后台需要统一管理产品、套餐、加油包、订阅账号、按量账号、充值面额、信用额度、按量模型定价、用量折扣策略和积分发放规则。

核心需求：

- 产品是订阅、按量、CodingPlan 三种业务模式的上游。
- 计费写操作由 billing 服务负责，admin 只提供管理入口。
- 财务数据、订单、交易、退款、余额调整、积分发放和报表必须落在 billing。
- 生产默认不允许跨库访问或本地兜底计费。

### 3.4 CodingPlan 与转售管理

后台需要支持 CodingPlan 的自营套餐、配额模板、三方套餐、供应商线路、上游权益、转售路由和报表。

核心需求：

- 自营 CodingPlan 使用配额模板描述实际网关执行规则。
- 三方/转售路径需要管理供应商线路、上游凭证、权益发放、重试和使用趋势。
- Gateway/Publisher 同步状态由 billing 管理，admin 只查看和触发受控动作。

### 3.5 供给、模型与渠道

后台需要管理模型库、模型访问、模型路由策略、供应商渠道、协议模板、投放设置、渠道健康、供应商成本和 provider cost policy。

核心需求：

- 渠道、模型、成本和路由策略会影响网关实际调用，必须通过 billing/publisher 的同步链路生效。
- 供应商成本支持按 provider、provider line、model、时间窗口和优先级配置。
- 能查看渠道健康、重置统计、测试渠道和发现模型。

### 3.6 风控、告警与工单

后台需要支持风险用户、风控规则、名单规则、告警事件、系统监控、工单中心、用户分群和漏斗分析。

核心需求：

- 风控规则和风险用户需要支持人工释放、封禁和历史查看。
- 告警事件需要支持列表、统计、标记已读和处理。
- 工单需要支持创建、回复、状态、分配、分类、优先级、关闭和合并。
- 用户分群既用于运营筛选，也会被发放规则、信用策略等模块引用。

### 3.7 营销与增长

后台需要支持组合套餐、活动、促销码、邀请裂变、公告通知、功能开关和系统提示词。

核心需求：

- 活动和促销码需要支持统计、启停、编辑和删除。
- 积分发放规则需要支持预览、手动触发、自动触发和 redemption 查看。
- 公告、功能开关和系统提示词属于后台控制面配置，需要审计。

### 3.8 财务中心

后台需要查看订单、Gateway 入账事件、交易流水、收入概览和财务报表，并支持订单取消、重试、退款、Gateway 入账重试和 publisher 同步任务重放。

核心需求：

- 财务报表需要支持 overview、details 和分页列表。
- Gateway billing event 是入账排障核心，需要能按 requestId 查看和重试。
- 退款、补偿、重试必须由 billing 服务执行，admin 只发起受权命令。

## 4. 非功能需求与约束

- 所有新后台能力必须遵守服务数据库所有权，不能绕过 user/billing internal API。
- 新页面必须接入权限配置，未授权用户不可见且不可访问。
- 管理写操作需要审计操作者、目标资源和请求上下文。
- 前端必须继续支持 chunk 失效自动刷新、懒加载和菜单预加载。
- 文案默认中文，Ant Design 使用 `zh_CN` locale。
- 新增生产配置必须更新 `.env.production.example`，且不能引入非 admin 所有的 secret。
- 变更前必须运行 `pnpm db-boundary:check`，常规验证使用 `pnpm typecheck` / `pnpm test` / Playwright e2e。

## 5. 关键入口

- API 入口：`apps/api/src/admin-main.ts`
- API 模块：`apps/api/src/app.module.ts`
- 后台聚合控制器：`apps/api/src/admin/admin.controller.ts`
- 后台仓储：`apps/api/src/admin/admin.repository.ts`
- User internal 客户端：`apps/api/src/user/user-internal.client.ts`
- Billing internal 客户端：`apps/api/src/billing/billing-internal.client.ts`
- Billing portal 代理：`apps/api/src/billing/billing-proxy.controller.ts`
- 前端路由：`apps/admin/src/app.tsx`
- 前端布局和菜单：`apps/admin/src/layouts/AdminLayout.tsx`
- 权限配置：`apps/admin/src/config/permissions.ts`
- Prisma schema：`apps/api/prisma/admin/schema.prisma`
- 数据库边界检查：`scripts/check-db-boundaries.mjs`
