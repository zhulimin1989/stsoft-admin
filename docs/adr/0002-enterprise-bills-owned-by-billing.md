# 企业账单账本归 billing，Admin 只做 v2 代理

企业账单、核销、账单调整、延期、Excel 下载，以及授信按账单自动失效/恢复，数据与作业都在 `codesphere-billing`。本仓库只新增 `/admin/v2/enterprise-accounts` 代理和新页面，不在 admin 库落账本。

能复用的旧 billing/user client 逻辑保持不变，仅增加 v2 路径；现网没有的月度应收账款能力必须在 billing 新建，不能把旧的钱包「调整余额」或充值 FIFO 清偿改名为账单核销。
