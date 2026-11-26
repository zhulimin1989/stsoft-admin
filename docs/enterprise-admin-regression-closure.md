# EAC22 回归收口（2026-10-08，第十二批）

发票页面的五标签导出/仅已开票显示发票号，以及已应用筛选快照/重置保持当前标签两项原断言保留，测试 timeout 仍各 20 秒。jsdom 测试使用 `ConfigProvider motion=false`，不改实际浏览器动画或页面行为。

定位到反复在完整 AntD DOM 上计算 role/可见性及逐字符输入引发的多次整页重渲染。测试改用真实 tablist/thead、精确 aria-label 和文本定位，仍断言 tab 选中、button 角色/可见/可用、真实 th 的 columnheader 角色/可见/名字、各状态导出参数。点击在 `act` 中等待 React 异步工作；筛选快照用例用实际 React onChange 的完整值事件，验证 applied 与 draft 分离，不测试逐键输入机制。没有替换 Table/Tabs/页面、删除导出和列校验、提高超时或跳过用例。

完整 Billing V2 契约保护 clean 钱包；浏览器“成功后缺钱包”用例先导入明确的历史 `LEGACY_DIRTY` 企业资源，再经真实服务开通/读取/故障，仍验证 FAILED_MANUAL、完整资源闸门及不覆盖资源。其它正常代办仍真实创建 clean V2 账户。正常 review 权限、可信上下文/UUID/幂等恢复及生产逻辑无变化。

原全量超时、隔离实验、当前完整回归和真实浏览器 17 项/旧流程 6 项日志均保留在需求目录 `execution/batch-12`；最终结果见第十二批记录/矩阵。没有生产数据操作、UAT部署或发布。门户 harness、IdP/provider/cache/Publisher/支付边界仍按原记录明确，不称实网验收。
