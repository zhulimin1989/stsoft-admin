# V2 列表读月汇总与垫付占用快照，作业写入

V2 已开户账务读 `enterprise_funding_snapshots`（已用信用垫付占用）。**企业账单 tab 列表 GET** 对每个账单月（含已定格闭月）一律现算消耗 / token / 三渠道，与 Excel「账单汇总」同一窗口，**不**读 `enterprise_bill_month_summaries` 金额，也**不**读 deadline 定格快照（汇总只供 refresh/close 写回、账户列表 `summarizeAccounts`、逾期闩锁偏好；定格行仍由 close 写入）。列表不返回代金券扣费 / 扣费金额列（三渠道里的「代金券抵扣金额」来自用量渠道现算，见 ADR-0021）。写入只走 billing 内部无参接口，由 K8s CronJob 打 billing ClusterIP；Admin 只做 JWT 代理。

## 读

- 已用信用 / 剩余信用：读快照行的已批准垫付未结清；缺行当 0。`summarizeAccounts.usedCents` 仍按「Σ待付款 + 当月未出账扣费」算出（读月汇总），但 Admin V2 **不**用它覆盖账户信息这三列（ADR-0017）。
- 余额：财务对账流水 `balance_transactions`（`ledger_sequence > 0`）按 `created_at DESC` 最新一条的 `balance_after_usd` 分位；无流水则空。不读钱包当场余额。
- 账期到期时间 / 临期标红：待付款 > 0 的月里最早死线；账户列表侧当月优先读月汇总行。
- 企业账单 tab 列表：每个月（含已定格闭月）现算请求数 / Token / 消耗对齐 Excel「账单汇总」（折后与分量 token；UTC 墙钟边界），不读 deadline 定格快照；三渠道按该账户 `token_usage` 北京月 GROUP BY，公式对齐财务对账「API用量扣费」（ADR-0021）。

## 写（定时任务）

| 接口 | 做什么 | Cron（Asia/Shanghai） |
| --- | --- | --- |
| `POST .../enterprise-bill-month-summaries/refresh` | 先刷新当前北京月汇总（含用量），再按 allocation SUM 回写全部企业垫付占用快照 | `*/15 * * * *` |
| `POST .../enterprise-bill-month-summaries/close` | 从最老缺行已闭月循环到赶完：定格消耗侧并写汇总。无请求体。抢不到锁 → skipped + hasMore，等下一轮 | `5 0 * * *` |

闭月锁是 session `pg_try_advisory_lock`，钉在 `connection_limit=1` 的连接上（无 BEGIN）；账户×月 persist 仍走连接池短提交。Forbid 并发，不在 Job 里拆页。
