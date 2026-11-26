# 企业账单口径修订（补充 PRD v2）· Spec

## Problem Statement

运营在企业账户 V2 的「企业账单」sheet 上对账时，仍按旧口径工作：应收含调整、列表用核销/未核销、消耗闭月后仍现算、核销/账单调整不改钱包。业务主管补充 PRD 与演示稿已把正典改为「扣费/应收定格、待付款公式、已付款仅核销、核销·调整按其他变动加余额、对账 Excel 按资金渠道拆分」。旧实现与新口径冲突，运营无法按新模板对账，也容易把「确认回款」和「改应收」搞混。

## Solution

在**不推翻**企业账户 V2 主入口（列表/三 sheet/当月仅下载/逾期只认待核销）的前提下，按补充 PRD 与 grilling 正典重做「企业账单」sheet、账单核销、账单调整、对账 Excel 四块：字段与公式对齐 `BILLING-FORMULAS.md`；闭月金额定格且迟到用量进未定格月；核销/调减/调增按「其他变动」联动余额；Excel 换用 `.v2` 模板口径。旧「未核销/核销金额/应收=消耗+调整」退出正典。行内文案统一「账单核销」。

## User Stories

1. As an 运营, I want 账单行看到请求数、token、消耗金额、代金券扣费、扣费金额, so that 能分清折后消耗与券抵扣。
2. As an 运营, I want 应收金额等于扣费金额且闭月后不变, so that 对账基准不被账单调整挪走。
3. As an 运营, I want 调整金额只进待付款、不进应收, so that 客户确认差异和平台应收基准分开。
4. As an 运营, I want 列表已付款金额只累计账单核销, so that 「确认回款」和月中余额实扣不是一列。
5. As an 运营, I want 待付款 = 应收 − 已付款 + 调整, so that 一行数字能勾稽。
6. As an 运营, I want 每个自然月单独算、不跨月累计, so that 调账和对账不会串月。
7. As an 运营, I want 闭月后消耗/券/扣费/应收定格, so that 导出后历史月不被延迟入账改写。
8. As an 运营, I want 闭月后才入账的用量进当前未定格月而不是撕开已定格月, so that 定格承诺成立。
9. As an 运营, I want 行内按钮叫「账单核销」, so that 与领域用语一致、不出现单独「核销」。
10. As an 运营, I want 账单核销金额 > 0 且不超过待付款, so that 不会超收确认。
11. As an 运营, I want 待付款为 0 时账单核销置灰、调增后待付款变正再恢复, so that 清账与再欠款流程顺。
12. As an 运营, I want 核销弹窗只读带出企业、月份、消耗、调整、应收、待付款, so that 填写前能核对。
13. As an 运营, I want 核销成功后该月已付款增加、待付款下降, so that 账单行立刻反映回款。
14. As an 运营, I want 核销成功后用户余额按其他变动增加、不走充值 FIFO, so that 确认回款与充值清偿分开。
15. As an 运营, I want 核销后已用信用只随待付款重算、不另写一笔已用信用流水, so that 避免双计。
16. As an 运营, I want 账单调整只改调整金额、应收定格不变, so that 平台应收基准稳定。
17. As an 运营, I want 调减后待付款不可为负, so that 不会把欠款调穿。
18. As an 运营, I want 调增无上限且待付款为 0 也可调增, so that 清账后仍能补记差异。
19. As an 运营, I want 调整原因必填, so that 每笔调整可追溯。
20. As an 运营, I want 调整弹窗只读带出企业、月份、消耗、已调整、应收、待付款并预览「应收不变、待付款 A→B」, so that 确认前知道结果。
21. As an 运营, I want 调减成功后余额增加、调增成功后余额减少且允许余额为负, so that 与其他变动口径一致。
22. As an 运营, I want 尚未付清时走调减、已付清时发券而不改账单的互斥约定写进产品知识, so that 运营知道选哪条路径（本期不做硬门禁亦可）。
23. As an 运营, I want 待核销 = 已付款为 0 且待付款 > 0，部分回款后显示已核销, so that 状态列与演示稿一致。
24. As an 运营, I want 逾期自动停授信仍只认状态待核销, so that 部分回款不关闸。
25. As an 运营, I want 待付款 > 0 且剩余账期 < 10 天整行标红, so that 催的是欠款月而非清账月。
26. As an 运营, I want 当月行仍只能下载, so that 不对未闭月做核销/调整/延期。
27. As an 运营, I want 下载 Excel 对齐 `.v2` 三 sheet 模板, so that 交给财务的文件与模板一致。
28. As an 运营, I want 汇总底栏为合计(消耗)→代金券扣费→应收, so that 与定格应收一致。
29. As an 运营, I want 明细行勾稽 总消耗 = 信用支付 + 代金券抵扣 + 已付款 + 待付款, so that 一行渠道拆得开。
30. As an 运营, I want 授信用户与预充值用户明细差异符合补充 PRD, so that 两类客户对账列含义清楚。
31. As an 运营, I want 导出即定格、差异只回后台调整与报表不回写 Excel, so that 发出去的对账单不被改。
32. As an 运营, I want 列表已付款与 Excel 明细已付款口径分离写清, so that 两列数字不同不被视为 bug。
33. As an 运营, I want 已用信用 = 当期未出账扣费 + Σ 各月待付款, so that 列表占用口径跟新待付款一致。
34. As an 运营, I want 预充值用户 ⇔ 预付款态、授信用户 ⇔ 授信已启用, so that 客户分类与状态不混。
35. As an 工程师, I want 主 PRD 未覆盖块（列表入口、认证 sheet、创建/补救等）保持不动, so that 本次只改账单口径。
36. As an 工程师, I want 领域用语与 ADR-0013～0015 / CONTEXT / BILLING-FORMULAS 一致, so that 实现不回退旧口径。
37. As an 工程师, I want 错误文案使用待付款而非未核销, so that 运营提示与 UI 列一致。
38. As an 工程师, I want 旧路由与旧 `/admin/enterprise-accounts` 行为不变, so that 回滚仍只靠菜单。

## Implementation Decisions

- **范围**：只改企业账单 sheet、账单核销、账单调整、对账 Excel 及相关 billing 组装/策略/入账；主 PRD 其余（V2 路由、当月仅下载、逾期只认待核销、预付款置灰优先级等）仍有效。
- **正典文档**：`CONTEXT.md`、`docs/pr-enterprise-account-refactoring-v2/BILLING-FORMULAS.md`、ADR-0013（定格+迟到用量 spill）、ADR-0014（其他变动加余额、已用信用公式重算）、ADR-0015（调增可负余额）。冲突以这些为准，不以旧 SPEC 应收=消耗+调整为准。
- **公式（账单调整场景）**：扣费 = 消耗 − 代金券扣费；应收 = 扣费（定格）；待付款 = 应收 − 已付款 + 调整；已付款（列表）= 仅账单核销累计；月度独立、禁止跨月累计。
- **定格**：闭月后快照消耗/代金券扣费/扣费/应收；之后只动调整、已付款、待付款。迟到用量不进已定格月，进首次可写未定格月。
- **校验**：账单核销金额 ≤ 待付款；调减后待付款不可为负；调增无上限；调整原因必填；账单核销备注仍可选 ≤100。
- **状态**：待核销 = 已付款 = 0 且待付款 > 0；已核销 = 其余（含部分回款）。
- **逾期**：继续只认状态 = 待核销且过账期截止时间；`pendingAtDeadline` / EXTEND 重装 / 自动恢复 provenance 规则保持。
- **临期标红**：待付款 > 0 且剩余账期 < 10；忽略补充 PRD「待付款为 0 标红」原文。
- **文案**：行内与弹窗「账单核销」；错误文案改「待付款」。
- **钱包**：核销/调减 → 余额 +=；调增 → 余额 −=（可负）；入账类型对齐现网「其他变动 / 调整余额」，不走充值 FIFO；已用信用不另写流水。
- **已用信用（列表）**：当期未出账扣费 + Σ 各月待付款。
- **Excel**：按 `.v2` 模板三 sheet；明细含信用支付/代金券抵扣/已付款/待付款/结算状态；勾稽四渠道之和；导出定格不回写。列表已付款 ≠ 明细行已付款（渠道拆分）。
- **互斥（发券 vs 调减）**：知识与运营约定写入 FORMULAS；本期不强制产品门禁（除非实现时零成本可加提示）。
- **模块**：billing 企业账单策略与服务（组装、定格存储、事件、Excel、触发其他变动）；admin v2 账单代理字段映射；V2 详情账单 sheet 与弹窗。不改旧企业账户页。
- **差异清单锚点**：已确认 D01–D18（D12/D14/D16/D17 为 Match 锚点；其余为待改）。

## Testing Decisions

- 好测试只断言对外行为：公式结果、校验文案、定格后字段不变、迟到用量落月、核销/调整后账单行与余额变动类型、状态/逾期门、Excel sheet 名与勾稽、UI 列名与弹窗必填/预览。不测 React 内部 state，不测旧 FIFO 充值实现本身。
- **主缝**：billing 企业账单 policy + service（含 Excel builder）。优先扩展现有 `enterprise-bills.policy.spec` / `enterprise-bills.service.spec` / `enterprise-bills-xlsx.spec`。
- **次缝**：admin `/admin/v2/enterprise-accounts/.../bills*` 代理字段与错误透出（现有 v2 controller spec 风格）。
- **薄缝**：账单 sheet 列与弹窗（原因必填、预览待付款、按钮「账单核销」）——能用组件测则测，不强制 E2E。
- Prior art：既有 enterprise-bills TDD 与 enterprise-account-admin-v2.controller.spec。

## Out of Scope

- 改旧 `/enterprise-accounts` 页与旧 `/admin/enterprise-accounts` 行为。
- 认证信息编辑、归属账单月/入账月、对客催收通知、新权限点。
- 用账单核销替换充值 FIFO。
- 强制「已付清必须发券、未付清禁止发券」的硬门禁（本期文档约定即可）。
- 重做账户信息 / 列表主 PRD 未改动块。
- 个人账户逾期 worker。

## Further Notes

- **As-built 同步**：实现事实与 UI/API 漂移见 `docs/pr-enterprise-account-refactoring/AS-BUILT-SPEC.md`（排查优先对照）；本文仍是账单口径修订的产品意图。
- 补充 PRD：`docs/pr-enterprise-account-refactoring-v2/企业账户管理-账单口径修订-PRD-v2.md`
- 演示稿：`docs/pr-enterprise-account-refactoring-v2/ui/`
- 公式知识：`docs/pr-enterprise-account-refactoring-v2/BILLING-FORMULAS.md`
- Excel 模板：`docs/pr-enterprise-account-refactoring-v2/2026-XX- XX公司-账单.v2.xlsx`
- 实现跨 `codesphere-admin` 与 `codesphere-billing`；本 issue 挂在 admin 仓库，billing 改动在同名 feature 分支协同。
- grilling 决议摘要：Q1-A 范围；新公式正典；定格+spill；钱包要动且其他变动；状态 Q8-C；已用信用公式重算；月度独立；预充值⇔预付款态。
