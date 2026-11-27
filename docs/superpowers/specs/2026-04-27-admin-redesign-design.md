# Admin 端重设计 · Design Spec

- **Date**: 2026-04-27
- **Scope**: codesphere-admin-saas / apps/admin
- **Owner**: 运营管理后台前端
- **Status**: Approved (brainstorm 阶段完成)
- **Next**: writing-plans 生成实施计划

---

## 1. 目标与非目标

### 1.1 目标

1. 解决 admin 端的"乱":视觉/排版乱、单页内容堆砌乱、操作流乱、业务逻辑表达不清
2. 接入 codesphere-frontend-saas 已有的 **stsoft Brand System V1** 设计 token,达成两端视觉统一
3. 用导航 IA 体现核心业务模型:**产品(Product) × 业务域**,支持三种 billingMode (订阅 / 配额套餐 / 按量付费)
4. 抽出 5 个共用组件,改一处全局生效
5. 落地 5 个样板页面 (Dashboard / Users / UserDetail / Channels / Orders),其余 16 个页面后续套样板逐步迁移

### 1.2 非目标(本次不做)

- ❌ 修改后端业务逻辑(计费扣款 / 订单状态机 / Stripe 回调 / Webhook)
- ❌ 数据库 schema 改动(列入"前置条件",由独立后端任务承担)
- ❌ 重写 26 个页面中除 5 个样板外的其他页面(后续迁移单独排)
- ❌ 改动用户端 (apps/web)
- ❌ 国际化重构

### 1.3 关键约束(红线)

- 后端计费已稳定,**不动**:订阅 / 加油包 / 按量 / Stripe / 订单审计 / 流水 / 退款
- 路由合并 ≠ 删接口:前端把多个页面合并是 UI 层面的事,后端 API 全部保留
- 权限点重命名:**前端做映射表** `legacyKey → newKey`,后端权限 key 不动,向后兼容
- 每个页面改造前先 grep 它依赖的 API,确保只动展示层

---

## 2. 业务模型(指导 IA 与组件设计)

### 2.1 三种 billingMode

| Mode | 用户买什么 | Key 怎么用 | 配额耗尽 |
|---|---|---|---|
| `SUBSCRIPTION` | 月费套餐 → 月度积分 | 一般不发 Key (Web/客户端消费) | 积分为 0 等下月;**可买加油包追加积分** |
| `CODING_PLAN` | 月费套餐 → 5h/7d/月 滚动窗口配额 | Key 消费配额 | 直接限流 (429),不切余额 |
| `PAY_AS_YOU_GO` | 充值预付余额 | Key 直接扣余额 | 余额为 0 拒服务 |

加油包 (BoosterPack) **只对 SUBSCRIPTION 模式有意义**,其他两种 mode 不挂加油包。

### 2.2 数据模型(目标态,前置后端任务)

```
Product
  ├─ billingMode: SUBSCRIPTION | CODING_PLAN | PAY_AS_YOU_GO

Plan (每个 Product 可挂多档)
  ├─ SUBSCRIPTION: 月费 + 月度积分
  ├─ CODING_PLAN:  月费 + N 条 PlanQuotaRule
  └─ PAY_AS_YOU_GO: 充值面额 + 赠送比例

PlanQuotaRule (CodingPlan 专用,运营完全自定义)
  ├─ windowType: ROLLING | FIXED_PERIOD | CUMULATIVE
  ├─ durationSec: 5h=18000 / 7d=604800 / 30d=2592000 / 自定义
  ├─ metric: REQUESTS | INPUT_TOKENS | OUTPUT_TOKENS | TOTAL_TOKENS | CREDITS
  ├─ limitValue: number
  └─ modelGroupId?: string  // 仅对此模型组生效

ApiKey
  ├─ productId: string  (新增,必填)
  └─ allowedModels?: string[]

UserBalance (按量产品的预付余额)
  ├─ userId, productId
  └─ balanceCents: bigint
```

**本次重设计依赖以上 schema**。若 schema 暂未落地:

- admin 中相关页面**只读地展示现有数据 + 加 TODO 占位**
- ApiKey.productId 缺失时,UI 上把所有 Key 归到一个虚拟"全局产品"
- PlanQuotaRule 缺失时,CodingPlan 套餐编辑器先用 mock 字段,后端就绪再切换

### 2.3 用户中心账户卡片规则(贯穿 admin UserDetail / 用户端)

**按用户实际拥有的产品动态渲染**:

| 用户实际有 | 显示 |
|---|---|
| 0 个产品 | 空状态:"该用户尚未订阅或购买任何产品" + [手动开通] [赠送试用] |
| 1 个产品 | 一张卡,**铺满整行** |
| 2 个产品 | 两张卡并排 (双列网格) |
| 3 个产品 | 第 1、2 张并排 + 第 3 张铺满 (按量产品因信息多默认铺满) |
| 4+ 个产品 | 双列网格自动换行;按量产品始终铺满 |

**卡片排序优先级**: CodingPlan > 订阅 > 按量

**特殊状态**:
- 配额/积分用尽:进度条变红 + 卡角标 ⚠ + "已用尽" 标签
- 订阅过期:卡片整体置灰 (opacity 60%) + "已过期, [续费] 恢复"
- 账号封禁:全部卡片置灰 + 顶部全局横幅"账号已封禁,编辑禁用"

---

## 3. 设计规范映射 (stsoft V1)

### 3.1 来源

直接复用 `codesphere-frontend-saas/src/styles/theme.ts` 的 `theme` 和 `antdTheme` 两个导出。

**步骤**:
1. 在 admin 端添加依赖或本地拷贝 (路径: `apps/admin/src/styles/theme.ts`)
2. `apps/admin/src/main.tsx` 用 AntD `ConfigProvider` 包裹 App,传入 `antdTheme`
3. `admin-shell.css` 重写,只保留 CSS 变量定义

### 3.2 Token 映射

| 用途 | 变量 | 值 |
|---|---|---|
| 页面底色 | `--bg-body` | `#F5F2EC` 米白 |
| 卡片/Sider/Header | `--bg-panel` | `#FAFAF7` 纸白 |
| 主操作 / 激活态 | `--primary` | `#0E2A47` 深海 |
| 强调标签 / 计费金额 | `--accent` | `#E8B464` 蜂蜜金 |
| 正文 | `--text` | `#2A2F3A` |
| 次要文字 | `--text-secondary` | `#6B7280` |
| 三级文字 | `--text-muted` | `#8B94A3` |
| 边框 | `--border` | `#C9CDD3` |
| 状态色(限定 4 个) | `--success / warning / error / info` | `#4A9B7F / #D98A3D / #C85A54 / #4A7FA5` |

### 3.3 字体 / 字号

- Sans: `Inter, -apple-system, "Source Han Sans SC", sans-serif`
- Mono: `JetBrains Mono, ui-monospace, monospace`
- 基础字号 `0.85rem` (≈ 13.6px)
- 标题字重 500 (不用 600)

### 3.4 圆角 / 阴影

- 按钮: 999 (药丸)
- 卡片: 8
- Modal: 16
- 阴影: 仅 sm 和 md 两级,禁用 lg / xl

### 3.5 禁用项 (admin 当前"乱"的根源)

- ❌ 表格 Tag 颜色随意 (gold/blue/cyan/purple/green 混用) → 收敛到 4 状态色 + 1 中性 (muted)
- ❌ inline `style={{ color: '#xxx' }}` 散布各页 → 必须走 token
- ❌ 多种字号混用 (12/13/14/16/20/24/28) → 收敛到 7 档 (xs/sm/base/md/lg/xl/2xl)
- ❌ AntD 默认蓝色激活态 → 用 6% primary 填充 + 右侧 2px primary 竖条

---

## 4. 整体壳布局 (AdminLayout)

### 4.1 结构

```
┌─Sider 240px─────┬──Header 56px────────────────────────────────┐
│ Logo            │ 面包屑                  [产品筛选器]  用户菜单 │
│                 ├─Content (bg-body)──────────────────────────┤
│ 菜单分组         │                                              │
│ - 概览           │   PageHeader                                 │
│                  │   StatCard ×N                               │
│ 用户运营         │   FilterBar                                  │
│ 产品中心         │   DataTable | Drawer                         │
│ 财务中心         │                                              │
│ 模型与渠道       │                                              │
│ 监控审计         │                                              │
│ 系统             │                                              │
└─────────────────┴──────────────────────────────────────────────┘
```

### 4.2 Sider

- 宽度 240px (原 220px)
- 背景 `--bg-panel`,右边框 1px `--border`
- 菜单分组用大写小标签 + 灰色字 (`--text-muted`, 11px, 0.6px 字距)
- 一级条目无折叠箭头,直接平铺 (代替原 inline 二级 Menu,常用页要点两次的痛点)
- 激活态: 6% primary 填充 + 右边 2px primary 竖条 + primary 文字色 + 字重 500

### 4.3 Header

- 高度 56px,背景 `--bg-panel`,下边框 1px `--border`
- **左**: 面包屑 (代替原空白)
- **中右**: 产品筛选器 (蜂蜜金虚线胶囊,详见 4.4)
- **右**: 用户菜单 (Dropdown,保留原退出登录)

### 4.4 产品筛选器 (新增,核心交互)

**视觉**:
- 蜂蜜金虚线胶囊,padding 5px 12px,fontSize 12px
- 锁定页面时变实线、不可点击,加灰色 lock 图标

**默认行为**:
- 首次登录 → "全部产品"
- 切换具体产品后,localStorage 记忆 (1 周过期)
- 第二次进 admin → 自动恢复
- 永远有"全部产品"选项

**页面强制锁定**:
- `/products/:id` (产品详情) → 锁到该产品
- `/plans/:id` (套餐详情) → 锁到该套餐所属产品
- `/api-keys/:id` → 锁到该 Key 所属产品
- 进入锁定页面时筛选器自动跳并禁用

**全局上下文**:
- React Context: `<ProductContext.Provider value={currentProductId}>`
- Hook: `useCurrentProduct()`,所有页面读取并加入 API 查询参数
- 切换时所有"受产品筛选器影响"的页面自动 refetch

---

## 5. 导航 IA (最终目录树)

| 分组 | 路由 | 名称 | 影响范围 | 备注 |
|---|---|---|---|---|
| **总览** | `/` | Dashboard | 受产品筛选器影响 | |
| **用户运营** | `/users` | 用户列表 | 全局 | |
| | `/users/:id` | 用户详情 | 全局 | 详情内含三种产品卡 |
| **产品中心** | `/products` | 产品管理 | 受产品筛选器影响 | CRUD + billingMode |
| | `/plans` | 套餐与活动 | 受产品筛选器影响 | **合并 4 页** (PlanTemplates / BoosterPacks / Campaigns / DiscountCodes) → 4 Tab |
| | `/plans/:id` | 套餐详情 | 受产品筛选器影响 | 按 billingMode 显示不同字段 |
| | `/api-keys` | ApiKey 管理 | 受产品筛选器影响 | **新增** |
| **财务中心** | `/orders` | 订单管理 | 受产品筛选器影响 | 含 Drawer 时间线,合并 OrderAuditLog |
| | `/usage` | 用量与流水 | 受产品筛选器影响 | **合并 3 视角** (Transactions / token 用量 / CodingPlan 配额消耗) |
| | `/revenue` | 收入分析 | 受产品筛选器影响 | 按 billingMode 拆分 |
| | `/payment-config` | 支付配置 | 受产品筛选器影响 | |
| **模型与渠道** | `/channels` | 渠道管理 | 全局 | |
| | `/model-pricing` | 模型定价 | 全局 | 仅 PAY_AS_YOU_GO 产品有意义 |
| **监控审计** | `/monitoring` | 实时监控 | 全局 | **合并 2 页** (Sessions / Monitoring) |
| | `/audit-logs` | 审计日志 | 全局 | |
| | `/announcements` | 公告 | 全局 | |
| **系统** | `/team` | 角色与账号 | 全局 | **合并 2 页** (Roles / Members) |
| | `/feature-flags` | 功能开关 | 全局 | |
| | `/system-prompts` | 系统提示词 | 全局 | |
| | `/system-config` | 系统设置 | 全局 | |

**删除**:
- ❌ `/model-access` 模型权限页 → 拆回到 PlanDetail (套餐→模型组) 和 ApiKey 管理 (Key→模型)

**统计**: 27 页 → 21 页 (合并 7 → 减 6 + 新增 ApiKey 管理 1 + 删除 ModelAccess 1)

### 5.1 权限点重命名 (按域分组)

```
旧                              新                          域
admin.users.manage           → users.manage                users
admin.products.manage        → products.manage             products
admin.plans.manage           → products.plans.manage       products (合并)
admin.booster_packs.manage   → products.plans.manage       products (合并)
admin.campaigns.manage       → products.plans.manage       products (合并)
admin.discount_codes.manage  → products.plans.manage       products (合并)
admin.orders.manage          → finance.orders.manage       finance
admin.transactions.read      → finance.usage.read          finance
admin.revenue.read           → finance.revenue.read        finance
admin.payment_config.manage  → finance.payment.manage      finance
admin.channels.manage        → ops.channels.manage         ops
admin.model_pricing.manage   → ops.pricing.manage          ops
admin.model_access.manage    → (删除)
admin.sessions.read          → audit.monitoring.read       audit (合并)
admin.monitoring.read        → audit.monitoring.read       audit (合并)
admin.audit_logs.read        → audit.logs.read             audit
admin.announcements.manage   → audit.announcements.manage  audit
admin.roles.manage           → system.team.manage          system (合并)
admin.members.manage         → system.team.manage          system (合并)
admin.feature_flags.manage   → system.flags.manage         system
admin.system_prompts.manage  → system.prompts.manage       system
admin.system_config.manage   → system.config.manage        system
```

**6 个域**: `users.* / products.* / finance.* / ops.* / audit.* / system.*`

**实施**: `apps/admin/src/config/permissions.ts` 新增映射表 `LEGACY_PERMISSION_MAP`,所有权限检查走映射,后端权限 key 不动。

---

## 6. 共用组件

### 6.1 PageHeader

```tsx
<PageHeader
  title="用户管理"
  subtitle="查看和管理睿动平台所有注册用户"
  breadcrumb={[{ label: '用户列表', to: '/users' }, '用户详情']}
  actions={[
    <Button key="export" variant="ghost">导出 CSV</Button>,
    <Button key="invite" variant="primary">+ 邀请用户</Button>,
  ]}
/>
```

- 替换原各页五花八门的 `<h2> + Button` 自由组合
- 必含: title, 可选 subtitle, breadcrumb, actions
- 高度固定,与下方组件 16px 间距

### 6.2 StatCard / StatCardGroup

```tsx
<StatCardGroup>
  <StatCard label="总用户" value={12486} delta={{ value: 124, period: '本周', trend: 'up' }} />
  <StatCard label="活跃订阅" value={3210} delta={{ value: 2.4, format: 'percent', trend: 'up' }} />
  <StatCard label="异常账号" value={17} variant="error" />
  <StatCard label="本月新增" value={486} />
</StatCardGroup>
```

- 默认 4 列网格,响应式 (2/3/4 自适应)
- value 字号 22px,字重 500
- delta 字号 11px,success / error / 中性三种颜色
- variant: `default | success | warning | error` (改 value 颜色)

### 6.3 FilterBar

```tsx
<FilterBar
  search={{ placeholder: '搜索...', value, onSearch }}
  filters={[
    <Select label="状态" options={...} />,
    <Select label="来源" options={...} />,
    <DateRangePicker label="时间" />,
  ]}
  activeChips={[
    { key: 'status', label: '异常账号', onRemove: () => {...} },
  ]}
  rightActions={<Button variant="link">导出当前结果</Button>}
/>
```

- 横向单行 (overflow 滚动),Search 在最左,filters 紧邻
- activeChips: 当前激活的筛选条件,胶囊样式可单独 ✕
- right: 导出 / 高级筛选等次要操作

### 6.4 DataTable

基于 AntD Table 封装,统一:
- 行高 36px
- 表头大写小字 (11px, 0.4px 字距, `--text-muted`),背景 2% primary
- 边框 `#F1ECE2`,hover 行底色 2.5% primary
- 默认列: `actions` 右对齐,出 `查看 / 编辑 / 删除` 等 link

```tsx
<DataTable
  columns={...}
  dataSource={...}
  rowKey="id"
  pagination={{ ... }}
  rowSelection={...}                              // 可选,批量操作
  onRowClick={(record) => openDrawer(record)}     // 可选,触发 Drawer
/>
```

**Tag 颜色规约** (替代各页随意上色):

| 语义 | variant | 视觉 |
|---|---|---|
| 成功 / 启用 / 健康 / 已支付 | `success` | 绿底深绿字 |
| 警告 / 待激活 / 波动 / 待处理 | `warn` | 金底深棕字 |
| 错误 / 异常 / 失败 / 停用 | `error` | 红底深红字 |
| 处理中 / 流转中 | `proc` | 蓝底深蓝字 |
| 中性 (产品名 / Provider / 类型标签等) | `muted` | 灰底深灰字 |

**禁用**: gold / cyan / purple / pink / volcano 等其他颜色。

### 6.5 DetailDrawer

```tsx
<DetailDrawer
  open={!!selectedId}
  onClose={() => setSelectedId(null)}
  width="40%"
  title="ORD-20260415-00127"
  subtitle="bob@example.com · AI 写作 · ¥200.00"
  status={<Tag variant="error">充值失败</Tag>}
  tabs={[
    { key: 'basic', label: '基本信息', content: <BasicTab /> },
    { key: 'audit', label: '操作记录', content: <AuditTab /> },
    { key: 'payment', label: '支付详情', content: <PaymentTab /> },
  ]}
  actions={[<Button>退款</Button>, <Button>导出</Button>]}
/>
```

- 从右侧滑出,默认 40% 宽 (列表占 60%)
- 列表保持原样,**不跳页**
- 选中行高亮 (4% primary 底色)
- 顶部 = title + subtitle + status,中部 = Tabs,底部 = actions
- 替换原"列表点击 → Modal"或"列表点击 → 跳新页"两种现状的混用

---

## 7. 样板页面规格

### 7.1 Dashboard (`/`)

**布局**:
1. PageHeader: "运营总览" + 副标题"当前范围: {产品筛选器值} · 近 30 天" + [导出报表] [自定义时间]
2. StatCardGroup (4 卡): 总用户 / 活跃订阅 / 本月收入 / 异常订单
3. 第二行: `2:1` 双栏
   - 左 panel: 收入趋势 (按产品堆叠面积图,近 30 天)
   - 右 panel: 产品贡献 (按收入排序的列表)
4. 第三行: `1:1` 双栏
   - 左 panel: 最近订单 (最新 5 笔)
   - 右 panel: 系统告警 (未处理 N 条)

**数据来源**: 现有 `dashboardApi.stats()` 扩展,具体字段在实施 plan 中列。

### 7.2 Users (`/users`)

**布局**:
1. PageHeader: "用户管理" + 副标题 + [导出 CSV] [+ 邀请用户]
2. StatCardGroup (4 卡): 总用户 / 本月新增 / 异常账号 / 缺少订阅
3. FilterBar: 搜索 + 状态 + 来源 + 产品 + activeChips
4. DataTable

**列**:
| 列 | 内容 |
|---|---|
| 邮箱 / 昵称 | 主行邮箱 + 副行昵称/ID |
| 当前订阅 | 多个 `muted` Tag 并列 (跨产品订阅) 或 `—` |
| API Key | 数量,如 "2 把" |
| 状态 | success / warn / error |
| 注册时间 | YYYY-MM-DD |
| 操作 | "查看" link → 跳 UserDetail |

### 7.3 UserDetail (`/users/:id`)

**布局**:
1. PageHeader 含面包屑: `用户列表 / {email}` + 副标题 (注册时间 / 最近登录) + [重置密码] [导出账户] [封禁]
2. 身份信息卡 (头像 + 姓名 + 邮箱 + 标签如"已实名/Auth0/VIP")
3. 5 个 Tab:
   - **账户与额度** (默认):产品卡动态渲染 (见 2.3)
   - **订单**:复用 Orders 表格 (筛选条件锁定 userId)
   - **用量与流水**:复用 Usage 视图
   - **API Key**:列出该用户所有 Key,可创建/吊销
   - **操作记录**:运营对该用户的操作日志

**产品卡形态**:

```
CodingPlan 卡:
  - 配额进度条 × N (按 PlanQuotaRule 渲染,接近上限变红)
  - 该产品下的 API Key 列表 (按"最近使用"排序)
  - 操作: [+ 新建 Key] [续费] [手动加配额]

订阅卡 (SUBSCRIPTION):
  - 套餐积分 (剩余 / 总额)
  - 加油包积分 (累加,显示金色)
  - 合计可用 (粗体)
  - 操作: [续费] [买加油包] [手动加积分]

按量卡 (PAY_AS_YOU_GO):
  - 三栏: 预付余额 / 本月用量 / 活跃 Key 数
  - 该产品下的 API Key 列表 (含本月消耗)
  - 操作: [+ 新建 Key] [充值] [手动调余额]
```

### 7.4 Channels (`/channels`)

**布局**:
1. PageHeader: "渠道管理" + 副标题"按健康度排序" + [健康检测] [+ 新建渠道]
2. StatCardGroup (4 卡): 总渠道 / 健康 / 异常 / 今日请求
3. FilterBar: 搜索 + 状态 + Provider + SDK
4. DataTable

**列**:
| 列 | 内容 |
|---|---|
| 渠道 | 主行名称 + 副行 `provider / sdkType` |
| 健康度 | dot + 文字 (ok 绿 / warn 金 / err 红) |
| 成功率 | 百分比,数字偏色 |
| 延迟 | ms |
| 今日请求 | 数字 |
| 权重 / 优先级 | "10 / 1" 格式 |
| 操作 | "详情" link → Drawer |

### 7.5 Orders (`/orders`)

**布局**:
1. PageHeader: "订单管理" + [导出] [异常订单]
2. StatCardGroup (5 卡): 今日订单 / 今日 GMV / 支付成功率 / 待处理退款 / 异常订单
3. FilterBar: 订单号/邮箱/交易号 + 状态 + 类型 + 产品 + 支付渠道 + 时间 + activeChips
4. DataTable + DetailDrawer (左 60% 完整表格,右 40% Drawer)

**Drawer 内容**:
- 标题区: 订单号 + 用户/产品/金额 + 状态 Tag (右上角)
- Tabs: 基本信息 / 操作记录 / 支付详情
- **基本信息 Tab**: 订单类型、支付渠道、支付时间、交易号、客户端 IP、失败原因 (如有)
- **基本信息 Tab 下半部分**: 时间线 (从 `OrderAuditLog` 渲染,每条一个 dot,颜色按事件类型)
- 底部 actions: 手动补单 / 退款 / 导出

### 7.6 其他 16 个页面

**不在本次实施范围**,但都遵循同一套规范:

- 进入页面 = PageHeader + StatCardGroup (可选) + FilterBar (列表型) + DataTable / 业务内容
- Tag 颜色按 6.4 收敛
- 详情用 Drawer 或独立路由 + PageHeader 面包屑
- 操作按危险等级:primary (主操作) / ghost (次要) / red ghost (危险)

---

## 8. 财务数据补齐 (9 项)

| # | 数据 | 来源 | 缺什么 | 放哪里 |
|---|---|---|---|---|
| 1 | 支付成功率 / 失败率 (按渠道、按时间) | orders.status | 按维度聚合的指标卡 + 趋势图 | Dashboard / Orders 头部 |
| 2 | 异常订单清单 | orders.status (各失败状态) | 一个"异常订单"快捷视图 | Orders 顶部按钮 |
| 3 | 用户级累计金额 (LTV) | orders + refunds | 累计消费 / 累计退款 / 净收入 | UserDetail 顶部 |
| 4 | 按 billingMode 拆分的收入 | orders + product.billingMode | 三种 mode 的收入对比 + 占比饼图 | Revenue |
| 5 | 加油包 / 促销码 / 活动收入贡献 | orders.orderType + campaign.id | 通过促销手段产生的订单占比 | Revenue |
| 6 | 按量产品的"用量 vs 充值"对比 | TokenUsage + UserBalance txns | 本月消耗 / 上月 / 同比聚合 | Usage |
| 7 | CodingPlan 配额耗尽用户清单 | UserSubscription + 配额消耗记录 | ≥80% 配额的用户列表 + 一键发提醒 | Usage / 新增报表 |
| 8 | 退款率 / 平均退款时长 | orders.refundedAt + refundReason | 退款分析视图 | Revenue / 退款分析 |
| 9 | 对账缺口 | Stripe API + 本系统 orders | 每日对账面板,显示差额 | Revenue / 对账 |

**原则**: 上述 9 项的数据来源大部分已经在 schema 里,本次只在 admin 前端做聚合视图。若个别字段确实缺,作为独立后端任务排,admin 中先标 TODO 占位。

---

## 9. 实施顺序 (供 writing-plans 阶段细化)

### Phase 0 · 基础设施 (前置)

1. 接入 stsoft V1 token (`apps/admin/src/styles/theme.ts` + AntD ConfigProvider)
2. 重写 `admin-shell.css` 为 token 版本
3. 5 个共用组件落地 (`apps/admin/src/components/common/`):
   - PageHeader / StatCard / FilterBar / DataTable / DetailDrawer
4. 权限映射表 `LEGACY_PERMISSION_MAP` 与 `usePermission` 改造

### Phase 1 · 壳与导航

1. AdminLayout 改造 (Sider 240 / 分组样式 / 激活态)
2. 顶部产品筛选器组件 + ProductContext + localStorage 持久化
3. 路由表重排 (合并 / 新增 / 删除)
4. 受产品筛选器影响的页面接入 useCurrentProduct

### Phase 2 · 5 个样板页面

1. Dashboard 重做
2. Users 列表重做
3. UserDetail 重做 (含三种产品卡 + 动态渲染规则)
4. Channels 重做
5. Orders 重做 (含 Drawer 时间线)

### Phase 3 · 财务数据补齐

按 §8 表格逐条接入,优先级 1-3 先做 (Dashboard/Orders/UserDetail 改造时一并)

### Phase 4 · 其余 16 页面套样板 (不在本 spec 范围)

- 套餐与活动 (合并 4 页)
- 实时监控 (合并 2 页)
- 角色与账号 (合并 2 页)
- 其他 (按现有功能套规范,不重做)

### 后端前置任务 (独立 spec)

- Product.billingMode 枚举落地
- ApiKey.productId 字段 + 历史数据迁移
- PlanQuotaRule 表
- UserBalance 表 (按量产品)

---

## 10. 测试策略

### 10.1 单元测试

- 5 个共用组件: 100% 行覆盖,props 边界 / 空状态 / 错误态
- 权限映射表: 全部 legacy → new 的双向测试
- 产品筛选器 Context: 默认值 / localStorage 持久化 / 锁定逻辑

### 10.2 E2E (Playwright)

- 5 个样板页面: 基本路径 (打开 / 筛选 / 翻页 / 操作 / Drawer)
- AdminLayout: 菜单分组渲染 / 权限过滤 / 产品筛选器切换
- 跨页面: 从 Users 跳 UserDetail,产品筛选器锁定;从 UserDetail 创建 Key 后回到 ApiKey 列表能看到

### 10.3 视觉回归

- Storybook (新增) 对 5 个共用组件做截图基线
- Playwright 对 5 个样板页面做截图回归

### 10.4 覆盖率门槛

- 共用组件 ≥ 95% (高频复用,门槛严)
- 样板页面 ≥ 85%
- 整体 admin 端 ≥ 85% (现有水平不降级)

---

## 11. 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| Schema 前置任务延期 | 部分卡片无数据 | UI 空状态 + TODO 占位,不阻塞 |
| 权限映射 bug 导致运营被锁外 | 高 | 灰度开关,异常时降级到旧权限 key |
| 产品筛选器引入全局状态污染 | 中 | Context 隔离,严格单元测试 |
| 5 个样板页面改造导致回归 | 中 | feature flag 切换新旧版,逐页放量 |
| stsoft token 与 AntD 冲突 | 低 | ConfigProvider 接管,inline style 全部清除 |

**回滚方式**: 每个 Phase 一个 feature branch,出问题整体 revert,旧路由保留。

---

## 12. 参考与依赖

- `codesphere-frontend-saas/src/styles/theme.ts` — stsoft V1 token 来源
- `codesphere-admin-saas/apps/admin/src/layouts/AdminLayout.tsx` — 现有壳
- `codesphere-admin-saas/apps/admin/src/config/permissions.ts` — 现有权限定义
- `codesphere-admin-saas/apps/api/prisma/schema.prisma` — 业务模型来源
- `~/.claude/projects/-Users-shineli-ruidong/memory/MEMORY.md` — 项目当前状态

---

## 13. 决策记录

| 决策 | 结论 | 理由 |
|---|---|---|
| IA 方向 | 双轴 (产品 × 业务域) | 业务核心模型就是产品 = 工作区 |
| billingMode 数 | 3 (订阅 / 配额 / 按量) | CodingPlan 是窗口配额,与积分订阅本质不同 |
| 加油包归属 | 仅 SUBSCRIPTION | 配额制和余额制都不需要 |
| ApiKey 是否绑产品 | 必绑 (productId) | 业务隔离 + 计费源清晰 |
| Key 的 creditSource | 不需要,由 product.billingMode 决定 | 用户已确认"CodingPlan Key 走配额,按量 Key 走余额,不混" |
| 产品筛选器默认 | 全部 + 记忆 1 周 + 锁定页强制 | 折中三种方案,详 §4.4 |
| CodingPlan 档位 | 完全运营自定义 (PlanQuotaRule) | 不写死,留扩展 |
| 模型权限页 | 删除 | 用户确认无用,逻辑拆回 PlanDetail / ApiKey |
| 权限点 | 按域重命名 + 前端映射 | 后端 0 改动,UI 整洁 |
| 样板页面数 | 5 (Dashboard/Users/UserDetail/Channels/Orders) | 覆盖概览/列表/详情/运维/财务五类 |
| 后端改动 | 0 (仅 admin 前端) | 用户明确红线 "不影响之前功能" |
