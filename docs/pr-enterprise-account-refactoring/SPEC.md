## Problem Statement

运营在「用户运营 / 企业账户」里管企业，详情还是右侧抽屉。账务态、认证态和按月对账挤在一起，企业账单（核销、账单调整、延期、下载）没有独立工作面。现网列表上的充值、授信、折扣入口也散。运营需要按北京时间自然月对上个月的网关按量消耗做对账，同时旧页面和旧接口必须原样留着，方便菜单一改就回滚。

## Solution

新增企业账户 V2：菜单只把入口指到新路由。列表按产品 §3 重做，详情改为整页三 sheet（账户信息 / 认证信息 / 企业账单）。企业账单是应收账款视图：消耗与 token 按北京时间自然月现算；闭月冻结默认账期截止时间；账单核销、账单调整、延期落事件。Admin 只做 `/admin/v2/enterprise-accounts` 代理；账本和逾期作业在 billing。旧 `/enterprise-accounts` 与 `/admin/enterprise-accounts` 不改。

视觉以 `docs/pr-enterprise-account-refactoring/ui/` 为准；账务规则以 `CONTEXT.md` 与 ADR-0001～0010 为准。稿面与规则冲突时按 BUILD-SPEC 覆盖，不按过时 PNG。

**As-built**：当前实现事实（含文案/接线漂移）见 `docs/pr-enterprise-account-refactoring/AS-BUILT-SPEC.md`；排查时公式以 CONTEXT + ADR-0013～0015 + BILLING-FORMULAS 为准，UI/API 接线以 AS-BUILT 为准。

## User Stories

1. As an 运营, I want 从「用户运营 / 企业账户」进入 V2 而不是旧抽屉, so that 日常只走一套新入口。
2. As an 运营, I want 回滚时只改回菜单指向旧路由, so that 线上出问题不必删新代码。
3. As an 运营, I want 直接打开旧书签 `/enterprise-accounts` 仍看到旧页, so that 并行期对照新旧数据。
4. As an 运营, I want 已开户账务与待审核队列两个分段, so that 账务客户和认证申请分开处理。
5. As an 运营, I want 按企业名称、USCC、手机号搜索, so that 能找到要对账的企业。
6. As an 运营, I want 列表只留「详情」, so that 充值、授信、折扣、挂载 tenant 都收敛到详情头。
7. As an 运营, I want 详情从列表跳转而不是开抽屉, so that 企业账单这种宽表放得下。
8. As an 运营, I want 返回列表时保留 Tab、搜索词和分页, so that 对完一户还能回到刚才的队列。
9. As an 运营, I want 列表看到明文手机号, so that 打电话催款不用再点进详情。
10. As an 运营, I want 账期到期时间显示该企业未核销账单里最早的账期截止时间, so that 一眼看到最紧急的回款日。
11. As an 运营, I want 任一未核销账单剩余账期小于 10 天时企业行整行浅红, so that 列表就能催款。
12. As an 运营, I want 没有未核销账单时账期到期时间显示「—」, so that 不会被空死线误导。
13. As an 运营, I want 右上角「创建 / 补救」, so that 开通失败仍能补救而不用回旧页。
14. As an 运营, I want 面包屑「用户运营 / 企业账户 / 企业详情」, so that 知道自己在哪。
15. As an 运营, I want 头部看到企业名称、账户状态、USCC, so that 确认没点错户。
16. As an 运营, I want 头部有充值、发券、配置信用额度、配置专属折扣、挂载 tenant, so that 常用动作不用回列表。
17. As an 运营, I want V2 详情头没有「调整余额」, so that 不会把改钱包和改应收搞混。
18. As an 运营, I want 三个 sheet：账户信息、认证信息、企业账单, so that 认证和账单不再挤在抽屉里。
19. As an 运营, I want 默认停在账户信息, so that 打开详情先看账务态。
20. As an 运营, I want 基础信息里看到账户 ID、类型、企业名称、USCC、Owner 用户、账户状态、来源实名 ID、创建时间、明文手机号、邮箱, so that 核对主体。
21. As an 运营, I want 空字段显示「—」、Owner 成员为空显示「无」, so that 知道是没数据而不是加载失败。
22. As an 运营, I want 看到余额、资金处理方式、企业授信、有效信用、已用信用、剩余信用、账户可用余额、信用状态、授信策略时间边界、授信到期时间, so that 分清配置额度、是否生效、还剩多少应收占用。
23. As an 运营, I want 负的余额、账户可用余额、未核销金额、已调整金额标红, so that 欠款和调减一眼能看出来。
24. As an 运营, I want 授信到期时间为空时显示「长期有效」, so that 不把「没填」当成缺失。
25. As an 运营, I want 资金处理方式在企业授信启用时写成「企业授信（额度 + 自然月结算 + N 天回款）」, so that 和按月对账口径一致。
26. As an 运营, I want 已用信用按「当期未出账消耗 + Σ 未核销金额」显示, so that 它表示应收账款占用而不是网关瞬时可花额度。
27. As an 运营, I want 有效信用仍是门控后的额度, so that 停用或过期时这一列是 0，和企业授信配置值分开。
28. As an 运营, I want 认证信息只读, so that 本期不误改实名。
29. As an 运营, I want 从开户月到当前月每月一行企业账单（含消耗为 0 的月）, so that 对账不漏月。
30. As an 运营, I want 账单按月份倒序, so that 先看到最近要核的月。
31. As an 运营, I want 当月行带「当月」标签, so that 知道这行还没闭月。
32. As an 运营, I want 当月只能下载, so that 不会对着还在涨的消耗做账单核销、账单调整或延期。
33. As an 运营, I want 已结束月份才能账单核销、账单调整、延期, so that 对的是上个月及更早。
34. As an 运营, I want 消耗总金额和 token 每次按北京时间自然月从用量现算, so that 和网关延迟入账的现网行为一致。
35. As an 运营, I want 自己不能手改消耗总金额, so that 计费层不被运营改写。
36. As an 运营, I want 闭月后默认账期截止时间按「该月月末 + 当时回款天数」冻结, so that 后来改回款天数不会挪走旧账单死线。
37. As an 运营, I want 改企业授信或回款天数不影响已闭月的账期截止时间, so that 额度重配不会重置账期。
38. As an 运营, I want 用延期只改那一张企业账单的账期截止时间, so that 缓冲回款而不动授信额度。
39. As an 运营, I want 已延期的行显示最新死线并带「已延期」, so that 能看出人工延过。
40. As an 运营, I want hover 已延期时看到原始死线, so that 对账能追溯。
41. As an 运营, I want 账单调整用调增/调减方向加正数金额, so that 不会在金额框里填负数。
42. As an 运营, I want 调减后应收不能为负, so that 不会把计费层削穿。
43. As an 运营, I want 调减后未核销可以为负, so that 已核销后再调减仍能留痕。
44. As an 运营, I want 账单调整实时预览应收和未核销变化, so that 确认前知道结果。
45. As an 运营, I want 账单调整记录不能改不能删, so that 写错只能反向再记一笔。
46. As an 运营, I want 账单调整不要归属账单月和入账月, so that 本期不做跨期收入口径。
47. As an 运营, I want 账单核销填写本次核销金额且可填非必填备注, so that 能记下回款差异。
48. As an 运营, I want 本次核销金额必须大于 0 且不超过未核销金额, so that 不会超核。
49. As an 运营, I want 未核销 ≤ 0 时核销按钮置灰并提示「无可核销金额」, so that 和没权限区分开。
50. As an 运营, I want 没权限时提示「无操作权限」, so that 不会误以为是预付款或没金额。
51. As an 运营, I want 预付款企业的核销、账单调整、延期置灰并提示「预付款账户无需核销」, so that 预收客户不去走应收流程，但仍能下载对账。
52. As an 运营, I want 置灰优先级为无操作权限 → 预付款账户无需核销 → 无可核销金额, so that 文案不互相覆盖。
53. As an 运营, I want 待核销表示从未账单核销且未核销 > 0, so that 零消耗月不会被当成欠款。
54. As an 运营, I want 未核销 ≤ 0 或发生过账单核销的月份显示已核销, so that 零消耗和部分回款都与 mockup 一致。
55. As an 运营, I want 未核销 ≤ 0 时剩余账期显示「—」, so that 清账月份不再倒计时。
56. As an 运营, I want 账单 sheet 上剩余账期小于 10 天的行整行标红, so that 催的是具体那张企业账单。
57. As an 运营, I want 宽表横向滚动且操作列固定在右侧, so that 行内四按钮始终够得到。
58. As an 运营, I want 下载前弹窗确认且只有北京时间, so that 不会误导出 UTC。
59. As an 运营, I want Excel 按模板三个 sheet 出账, so that 客户拿到的和财务模板一致。
60. As an 运营, I want 所有 Excel 标题旁写数据截至导出时刻, so that 现算消耗对得上文件。
61. As an 运营, I want 当月 Excel 另标「未定格」且明细截止昨天 23:59:59（北京时间）, so that 月中导出不含当日半成品。
62. As an 运营, I want 账单明细超过 Excel 行数上限时按自然日拆 sheet, so that 不拆断整天。
63. As an 运营, I want 给企业发券时选产品, so that 代金券落到对应 tenant，底层仍走现有 voucher。
64. As an 运营, I want 配置信用额度必须原地 UPDATE, so that 授信策略时间边界和变更历史不断裂。
65. As an 运营, I want 额度重配不重置任何企业账单的账期截止时间, so that 只改预算大小。
66. As an 运营, I want 充值和专属折扣弹窗视觉跟现网一致但放在 V2 文件里, so that 旧页完全不动。
67. As an 运营, I want 接口失败时 toast 且页面仍可操作, so that 一次失败不会卡死对账。
68. As an 运营, I want 待核销且已过账期截止时间时企业授信自动失效, so that 欠款月到期会停新授信。
69. As an 运营, I want 发生过账单核销的月份即使未核销 > 0 也不触发自动失效, so that 部分回款不关闸。
70. As an 运营, I want 所有这类逾期企业账单未核销 ≤ 0 后自动恢复授信, so that 清账后不用手点启用（相对现网人工恢复）。
71. As an 运营, I want 死线到达时还不是待核销、之后才因延迟用量变成待核销的月份不回溯停授信, so that 网关补单不会误杀。
72. As an 运营, I want 充值仍按现网 FIFO 清偿钱包债务, so that 资金路径不变。
73. As an 运营, I want 账单核销不改钱包余额, so that 应收账款确认和注资填坑分开。
74. As an 工程师, I want 旧 controller 和旧页面一行行为都不改, so that 回滚只动入口接线。
75. As an 工程师, I want 新 API 走 `/admin/v2/enterprise-accounts` 并尽量复用 billing/user client, so that 能复用的逻辑保持一致。
76. As an 工程师, I want 切月按北京时间而不是现网 UTC 月汇总, so that 月末附近不串月。
77. As an 工程师, I want 企业逾期作业不改个人账户旧 worker, so that 个人透支逾期行为不变。

## Implementation Decisions

- 只改入口接线：菜单指向 `/enterprise-accounts-v2`，注册新路由，新 path 映射到现有 `admin.page.enterprise_accounts.*`。不新增权限点。旧路由、旧页面、旧 `/admin/enterprise-accounts` 行为不改。
- 新 Admin API 前缀 `/admin/v2/enterprise-accounts`。列表、详情、充值、授信、折扣、发券、挂载 tenant、审核队列能复用的，内部调用现有 billing/user client，路径带 v2，逻辑不变。
- 企业账单、账单核销、账单调整、延期、Excel、按月逾期/恢复在 billing 新建。Admin v2 只代理。本仓库不落账本。
- 企业账单是视图：按北京时间自然月从用量汇总消耗和 token。不落消耗快照。账单核销、账单调整、延期写事件，按账单月折算展示。
- 闭月 = 北京时间次月 1 日 00:00:00。闭月后幂等冻结该月回款天数和默认账期截止时间（首次读取或回扫即可）。之后改企业授信或回款天数不挪该月死线；只有延期事件能改。
- 当月行加「当月」标签；账单核销、账单调整、延期置灰；仅下载。已结束月份开放这三操作（再叠加预付款、权限、未核销金额规则）。
- 已用信用（V2）= 当期未出账消耗 + Σ 未核销金额。这是应收账款占用。网关能否继续花仍看钱包余额 + 有效信用。账单核销 / 账单调整不改钱包。旧抽屉仍用 allocation 口径；并行期两页数字可以不同。
- 有效信用 = 门控后额度。剩余信用 = 企业授信 − 已用信用。
- 账单状态：待核销 = 核销金额为 0 且未核销 > 0。已核销 = 其余（含零消耗、已清账、部分回款）。
- 自动失效：存在待核销且已过账期截止时间。发生过账单核销的月份不参与。全部这类逾期账单未核销 ≤ 0 后恢复。未核销 ≤ 0 不参与失效。死线当时还不是待核销、之后才因延迟用量变为待核销的，只标红可核销，不回溯停授信。
- 个人账户逾期仍走现网 allocation + 钱包为负的 worker。企业账户改走月账单规则。充值 FIFO 清偿照旧。
- 预付款（由授信配置派生，不是账户 type）：核销 / 账单调整 / 延期置灰，tooltip「预付款账户无需核销」；仍可下载。
- 按钮置灰优先级：无操作权限 → 预付款账户无需核销 → 无可核销金额。
- 上线回刷：每个企业从开户月到当前月都能展开账单行；闭月死线可幂等冻结，供逾期作业使用。不因「没人点开详情」而缺月。
- 账单调整：方向显式、金额恒正；调减后应收不得为负；未核销可为负；无归属账单月 / 入账月。
- 账单核销：金额 > 0 且 ≤ 未核销；非必填备注 ≤ 100 字。
- 下载：弹窗仅北京时间；Excel 用仓库模板；全部文件标注导出时刻；当月另标未定格；明细超行按自然日拆 sheet。不复用现网 UTC `DATE_TRUNC` 月汇总。
- 发券：按产品发到企业下对应 tenant，复用现有 voucher 入账，不改钱包规则。
- 配置信用额度：原地 UPDATE，禁止 delete + insert；变更进授信事件表。
- 新 UI 复用现有 Admin 组件与样式规范，全部新文件。不把信用额度、发票、促销码、按量账号菜单并进来。
- 测试主缝（本仓库）：`/admin/v2/enterprise-accounts` 代理，billing/user client 用测试替身。不测旧 proxy 的既有行为是否被改（它们必须保持原样）。

## Testing Decisions

好测试只断言对外行为：HTTP 状态与载荷、代理是否打到 billing 的哪类能力、按钮可否点、标红/标签/toast、权限与预付款/未核销的置灰文案。不测 React 内部 state、不测 billing 钱包 FIFO 的既有实现（那是 billing 回归）。

本仓库要测的模块：

- Admin v2 企业账户代理：列表（最早账期截止时间、标红所需字段）、详情三视角、企业账单列表（当月标记、开户月起连续月、零消耗已核销）、账单核销/账单调整/延期/下载的请求校验与代理、发券、授信 UPDATE、当月写操作被拒绝。
- V2 页面：列表浅红、详情头无调整余额、当月标签与三按钮置灰、核销备注、下载仅北京时间、账单调整无归属/入账月、预付款 tooltip。

Prior art：现有 `EnterpriseAccountAdminProxyController` 规格测试（注入 billing/user 替身 + 管理端请求上下文）；`EnterpriseAccounts` 下的弹窗与幂等测试。V2 用同一风格，不要去改这些旧测试所覆盖的旧模块。

billing 仓库的月视图、事件落库、逾期/恢复、延迟用量不回溯停授信，在 billing 用其服务层测试；本仓库用替身断言调用了对应内部 API。不要在 admin 测里复制一套账本。

## Out of Scope

- 改旧页面、旧路由行为、旧 `/admin/enterprise-accounts`。
- 归属账单月、入账月。
- 认证信息编辑 / 重新认证。
- 账单操作记录报表。
- 到期对客提醒（短信/邮件）。
- 新增独立权限点、埋点。
- 把信用额度、发票、促销码、按量账号并进本菜单。
- 用账单核销去改钱包或替换充值 FIFO。
- 把现网每笔 `credit_due_at` 迁到月账单。
- 在 admin 库落企业账单账本。

## Further Notes

- 领域用语见根目录 `CONTEXT.md`。实现决策见 `docs/adr/0001`–`0010`。画面与覆盖表见 `docs/pr-enterprise-account-refactoring/BUILD-SPEC.md`。
- 消耗「不可变」在本期含义是：运营不能改；系统因延迟入账可以变。
- 9 月整月企业账单的默认死线是月末 + 回款天数，宽于现网「发生时刻 + termsDays」。旧分摊死线不要改。
- 并行期同一企业在旧抽屉和新详情上的已用信用可以不同，不是 bug。
