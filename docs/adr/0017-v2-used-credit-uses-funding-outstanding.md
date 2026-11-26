# V2 账户信息已用信用改回 V1 垫付占用

V2 详情「账户信息」的已用信用、剩余信用、账户可用余额与 `/credit`、V1 抽屉同源：已用 = 授信分摊未清偿（approved_credit − settled）。账户可用余额 = max(0, 余额) + 剩余信用（与用户侧同一公式；status ≠ ACTIVE 时剩余信用按 0 计入）。Admin 不再用账单汇总 `usedCents`（待付款占用）覆盖这三列。企业账单列表与 Excel 仍走各自口径，不受影响。

GET 读 `enterprise_funding_snapshots`，不对 allocation 现算 SUM；SUM 只发生在 refresh 作业里（ADR-0020）。

V2 列表与详情「余额」列覆盖为财务对账流水最新变动后余额，不读钱包当场额。

这取代 ADR-0005「V2 已用信用用账单口径、新旧页数字不同是预期」。
