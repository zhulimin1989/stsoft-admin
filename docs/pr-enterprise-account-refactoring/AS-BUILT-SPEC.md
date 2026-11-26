# 企业账户 V2 · As-Built Spec（实现同步）

> 目的：把**当前已落地实现**同步成可排查的正典描述，并与 `CONTEXT.md` 核心术语对齐。  
> 与主 SPEC / 账单口径修订 SPEC 的关系：后者是产品意图；本文记录 as-built 事实（含已知漂移）。冲突排查时：**账务公式与状态机以 CONTEXT + ADR-0013～0015 + BILLING-FORMULAS 为准；UI 文案与接线以本文为准**。

## Problem Statement

运营与工程师在排查企业账户 V2（列表、三 sheet、待审核队列、企业账单核销/调整/延期/下载）时，主 SPEC 与补充 PRD 仍描述部分「应然」行为，而工作区已实现口径（待付款公式、其他变动加余额、UI 文案、API 客户端混用、当月 Tag 等）已漂移。缺少一份按领域术语写清的 as-built 规格，导致对照代码/接口时反复猜「是不是还没做 / 是不是改坏了」。

## Solution

以当前 codesphere-admin（V2 前端 + `/admin/v2/enterprise-accounts` 代理）与协同 codesphere-billing（企业账单组装、定格/spill、事件、Excel、逾期）的**已实现行为**为准，产出本 as-built SPEC：覆盖入口与回滚、列表/审核队列、详情三 sheet、企业账单操作与文案、资金/授信术语展示、API 接线边界，以及已知漂移清单，便于后续回归与排障。

## User Stories

1. As an 运营, I want 从「用户运营 / 企业账户」进入 V2 路由, so that 日常只走新入口。
2. As an 运营, I want 菜单回指旧路由即可回滚, so that 不必删新代码。
3. As an 运营, I want 旧书签 `/enterprise-accounts` 仍打开旧页, so that 并行期可对照。
4. As an 运营, I want 列表分「已开户账务」与「审核队列」两段, so that 账务客户与申请单分开处理。
5. As an 运营, I want 按企业名称、统一社会信用代码、手机号搜索已开户列表, so that 能快速定位对账企业。
6. As an 运营, I want 已开户列表列含企业名称、统一社会信用代码、手机号、账户状态、余额、信用额度、账期到期时间、详情, so that 一眼看到催款与授信配置额度。
7. As an 运营, I want 列表「信用额度」列展示企业授信配置的额度数值, so that 不与「有效信用 / 剩余信用」混淆。
8. As an 运营, I want 任一待付款账单剩余账期小于 10 天时企业行整行标红, so that 列表即可催款。
9. As an 运营, I want 账期到期时间取该企业所有待付款金额 > 0 的账单里最早的账期截止时间，没有则为「—」, so that 看到最紧急回款日。
10. As an 运营, I want 列表操作只留「详情」, so that 充值/授信/折扣/挂载收敛到详情头。
11. As an 运营, I want 审核队列看到待审核 / 待付款 / 驳回 / 开通失败等申请态, so that 认证开通与账务列表分离。
12. As an 运营, I want 在审核队列做通过、驳回、作废、看凭证与执照, so that 不必回旧页。
13. As an 运营, I want 右上角「创建 / 补救」在账务 Tab 可用, so that 开通失败可补救。
14. As an 运营, I want 详情为整页三 sheet（账户信息 / 认证信息 / 企业账单）, so that 宽表对账放得下。
15. As an 运营, I want 默认停在账户信息 sheet, so that 先看账务态。
16. As an 运营, I want 头部看到企业名称、账户状态、USCC 与充值、发券、配置信用额度、配置专属折扣、挂载 tenant, so that 常用动作在详情完成。
17. As an 运营, I want V2 详情头没有「调整余额」, so that 不把改钱包和改应收搞混。
18. As an 运营, I want 账户信息看到余额、资金处理方式、企业授信（信用额度）、有效信用、已用信用、剩余信用、账户可用余额、信用状态、授信边界与授信到期时间, so that 分清配置与占用。
19. As an 运营, I want 资金处理方式在预付款态显示「预付款」，在授信启用时显示「信用额度（额度 + 自然月结算 + N 天回款）」, so that 与 as-built UI 一致（领域概念仍是企业授信）。
20. As an 运营, I want 授信到期时间为空时显示「长期有效」, so that 不把空当成缺失。
21. As an 运营, I want 负的余额与待付款金额等标红, so that 欠款一眼可见。
22. As an 运营, I want 认证信息只读展示实名快照与证件入口, so that 本期不误改认证态。
23. As an 运营, I want 企业账单按月份倒序、从开户月铺到当前月, so that 对账不漏月。
24. As an 运营, I want 账单列含请求数、Token、消耗金额、代金券扣费、扣费金额、应收金额、调整金额、已付款金额、待付款金额、状态、账期截止时间、剩余账期与行内操作, so that 对齐账单口径修订正典。
25. As an 运营, I want 当月行仅能下载（服务端/行内 disable reason 生效）, so that 不对未闭月做账单核销、账单调整或延期。
26. As an 运营, I want 行内与弹窗文案使用「账单核销」, so that 与领域用语一致。
27. As an 运营, I want 账单核销金额 > 0 且不超过待付款, so that 不会超核。
28. As an 运营, I want 账单调整用调增/调减 + 正数金额、调减后待付款不可为负、原因必填, so that 应收定格而待付款可纠偏。
29. As an 运营, I want 调整弹窗预览「应收不变、待付款 A→B」, so that 确认前知道结果。
30. As an 运营, I want 延期只改该月账期截止时间并标「已延期」, so that 可追溯原始死线。
31. As an 运营, I want 下载前确认且仅北京时间；当月 Excel 标未定格、明细截止昨天 23:59:59；已定格月标已定格、明细截止该月最后一天 23:59:59（北京时间）, so that 与财务模板一致。
32. As an 运营, I want 预付款企业账单核销/调整/延期置灰并提示预付款无需核销, so that 仍可下载对账。
33. As an 运营, I want 置灰文案能区分无权限、预付款、无可核销/当月等, so that 不互相覆盖。
34. As an 运营, I want 待核销 = 已付款为 0 且待付款 > 0，其余为已核销（含部分回款）, so that 状态列与演示一致。
35. As an 运营, I want 账单 sheet 上待付款 > 0 且剩余账期 < 10 天整行标红, so that 催的是欠款月。
36. As an 运营, I want 核销/调减成功后余额按「其他变动」增加、调增可致余额为负, so that 与 ADR-0014/0015 一致。
37. As an 运营, I want 已用信用随待付款公式重算而不另写已用信用流水, so that 避免双计。
38. As an 工程师, I want 读列表/详情/账单/核销/调整/延期/下载/发券/创建走 `/admin/v2/enterprise-accounts`, so that 新能力集中在 v2 代理。
39. As an 工程师, I want 排查时知道详情内充值、读/写授信、专属折扣、挂载 tenant、审核队列仍可能打旧 `/admin/enterprise-accounts` 客户端, so that 不误判「v2 缺接口」。
40. As an 工程师, I want 账本与逾期作业仍在 billing, so that admin 不落账本。
41. As an 工程师, I want 闭月定格 + 迟到用量 spill、列表已付款仅核销累计、Excel 渠道拆分已付款与列表列分离等行为可对照 BILLING-FORMULAS, so that 数字差异可归因。
42. As an 工程师, I want as-built 明确「当月」Tag 当前未在月份列渲染, so that 不把缺 Tag 当成当月门禁失效。
43. As an 工程师, I want 术语「企业授信 / 信用额度 / 预付款 / 待付款 / 账单核销」与 CONTEXT 对齐说明, so that 文档与 UI 对照不串义。
44. As an 工程师, I want 旧 controller 与旧页行为保持, so that 回滚只动入口。
45. As an QA, I want 用最高缝（billing 账单 policy/service/xlsx → admin v2 代理 → 薄 UI 组件）做回归, so that 少而稳的测试面覆盖公式与文案。

## Implementation Decisions

- **并行与回滚**：菜单指向 V2；旧路由与旧 `/admin/enterprise-accounts` 行为不改（ADR-0001）。
- **领域正典**：账务公式、定格/spill、其他变动加余额、已用信用公式重算、调增可负余额 → `CONTEXT.md`、`BILLING-FORMULAS.md`、ADR-0013～0015。旧「应收 = 消耗 + 调整 / 未核销」退出正典。
- **Admin 职责**：`/admin/v2/enterprise-accounts` 代理 billing/user；本仓库不落账本。企业账单事件类型：`WRITE_OFF` / `ADJUST` / `EXTEND`。
- **前端模块（as-built）**：V2 列表页、详情页、账户信息 sheet、认证信息 sheet、审核队列面板、账单行操作按钮、金额/资金处理方式/信用状态等 formatters；账单行类型含扣费/应收/已付款/待付款等字段。
- **API 接线（as-built，排查关键）**：
  - **走 v2**：列表、详情、账单列表、账单核销/调整/延期/下载、发券、创建/补救、tenant 列表等（v2 client 已具备对应方法）。
  - **仍走旧 enterprise-accounts client（常见）**：详情内充值、`getCredit` / `updateCredit` / credit-events、专属折扣读写、挂载 tenant；审核队列的申请列表/详情/审核/凭证。
  - **说明**：v2 client 已有 `updateCredit` 等方法，但详情授信弹窗路径 as-built 仍调旧 client；排查「授信读不到」时先看旧 proxy 与会话，勿默认只查 v2。
- **术语与 UI 文案（as-built 对齐）**：
  - 领域概念 **企业授信** = 配置的信用额度及启用状态。
  - 列表列名 **「信用额度」** = 展示该配置额度（`limitCents`），不是「信用额度」全局策略菜单。
  - 账户信息标签 **「企业授信（信用额度）」**；头部按钮 **「配置信用额度」**。
  - **资金处理方式**：预付款态 →「预付款」；授信启用 →「信用额度（额度 + 自然月结算 + N 天回款）」（主 SPEC story 25 的「企业授信（…）」为历史应然文案，as-built 以本句为准）。
  - 列表 **「统一社会信用代码」** 列对应领域 **USCC**。
  - 账单操作与领域用语：**账单核销**、**待付款金额**、**已付款金额**、**调整金额**、**应收金额**（= 扣费定格）。
- **当月**：
  - 语义仍在：`currentMonth`、行内 disable reason（如「当月仅支持下载」）、下载弹窗说明未定格。
  - **UI 漂移**：账单「账单月份」列旁 **未渲染「当月」Tag**（主 SPEC story 31 应然；排查时勿据此判定门禁丢失）。
- **账单操作门禁**：当月 / 预付款 / 权限 / 待付款约束由 billing 组装进 `*DisabledReason`；UI 用统一禁用按钮展示 tooltip。
- **临期标红**：列表用 `dueWarning`；账单 sheet 用 `pendingCents > 0 && remainingDays < 10`。
- **授信到期提交**：授信配置日期提交路径 as-built 使用 UTC 日末（`T23:59:59.999Z`）一类约定；与「账期截止时间」北京时间展示区分排查。
- **Excel**：北京时间、三 sheet、`.v2` 渠道拆分；列表已付款 ≠ 明细行已付款。
- **不测旧 proxy 既有行为是否被改**；回归焦点在 v2 与 billing 企业账单。

## Testing Decisions

好测试只断言对外行为：HTTP 状态与载荷、公式结果、校验文案、定格后字段不变、迟到用量落月、核销/调整后账单行与余额变动类型、状态/逾期门、Excel 勾稽、按钮可否点与 tooltip、formatters 文案。不测 React 内部 state，不测旧充值 FIFO 实现本身。

**测试缝（由高到低；优先已有缝，理想少缝）：**

1. **主缝（最高）**：billing 企业账单 policy + service + xlsx（公式、定格/spill、事件、禁用 reason、Excel）。Prior art：既有 `enterprise-bills.*.spec`。
2. **次缝**：admin `/admin/v2/enterprise-accounts` 代理（字段映射、错误透出、下载 Content-Disposition）。Prior art：v2 controller spec。
3. **薄缝**：formatters（资金处理方式/信用状态/金额标红）、`BillActionButton`、AccountInfoSheet / VerificationInfoSheet、审核队列面板的对外文案与禁用。Prior art：`EnterpriseAccountsV2/__tests__/*`。

不新增第四层「整页 E2E」作为本 SPEC 必选项；需要时另开。

## Out of Scope

- 改旧 `/enterprise-accounts` 页与旧 `/admin/enterprise-accounts` 行为。
- 认证信息编辑、对客催收通知、新权限点。
- 用账单核销替换充值 FIFO。
- 强制「已付清必须发券」硬门禁。
- 个人账户逾期 worker。
- 本 SPEC **不要求立刻消掉** as-built 漂移（当月 Tag、资金处理方式前缀「信用额度」vs 历史「企业授信」、详情写路径混用旧 client）；那些是后续整改 ticket，不是本文交付范围。本文只同步事实并术语对齐。

## Further Notes

- **测试缝请确认**：是否同意以「billing 企业账单 → admin v2 代理 → 薄 UI formatters/sheets」三层为默认回归面？若希望压成单缝，优先只保 billing 主缝 + 少量代理冒烟。
- 主产品 SPEC：`docs/pr-enterprise-account-refactoring/SPEC.md`、`BUILD-SPEC.md`
- 账单口径修订：`docs/pr-enterprise-account-refactoring-v2/SPEC.md`、`BILLING-FORMULAS.md`
- 领域用语：`CONTEXT.md`（含 UI 展示别名说明）
- ADR：0001～0012（V2 并行与账单基础）+ 0013～0015（定格/spill、其他变动、调增可负）
- 已知 as-built 漂移速查：
  1. 资金处理方式启用文案前缀为「信用额度」而非「企业授信」
  2. 账单月份列无「当月」Tag（门禁仍在）
  3. 详情部分写操作与审核队列走旧 admin client
  4. 列表列「信用额度」= 企业授信配置额度展示名
- 本地演示种子（排障可选）：billing demo 企业账户、console 待审核申请单脚本；登录与端口以团队本地约定为准。
