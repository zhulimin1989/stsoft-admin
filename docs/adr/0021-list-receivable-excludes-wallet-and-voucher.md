---
status: accepted
supersedes: ADR-0018
---

# 列表应收扣券扣与账户支付；已付款只含清偿和核销

企业账单列表要和财务用量报表三渠道对齐，并让「应收 = 已付款 + 待付款」恒成立。已付款不再含消费时的钱包本金；那一列单独叫账户支付金额。待付款允许为负，不再钳成 0。

## 列表三渠道

与财务对账「API用量扣费」`mapFinanceApiUsageRows` 同行公式，按 `token_usage` 北京自然月加总可见调用。

| 列 | 用量报表键 | 取数 |
| --- | --- | --- |
| 账户支付金额 | `paymentDeductionUsd` 本金扣费 | 非授信垫付、非负余额垫付分摊的 `recognizedRevenueUsd`；无分摊时用用量资金快照本金或整笔客户扣费 |
| 代金券抵扣金额 | `voucherDeductionUsd` 赠送扣费 | 同上「已收款」分摊的 `bonusConsumedUsd`；无分摊为 0 |
| 信用支付金额 | `creditDeductionUsd` 信用扣费 | 用量资金快照 `customerApprovedReceivableUsd`，否则 `source = ENTERPRISE_CREDIT` 且无 grant：已分类用 `approvedCreditUsd`，否则 `amountUsd` |

`NEGATIVE_BALANCE` 无 grant 分摊不进本金、不进赠送。列表 GET 一律按账户×月 GROUP BY 现算三渠道，不按 `request_count` 切读汇总。含已定格闭月在内，请求数 / Token 总量 / 消耗金额与 Excel「账单汇总」同口径（折后消耗、折后>0 分量 token、同窗明细行数；UTC 墙钟边界），不读 `enterprise_bill_month_summaries`，也不读 deadline 定格快照。定格行仍由 close 写入，不作为列表这三列。月汇总仍缓存账户支付与信用支付，供 refresh/close 写回。

## 列表金额

```
应收 = 消耗 − 代金券抵扣 − 账户支付 + 调整 − 发券
已付款 = 授信 FUNDING（按被清偿消耗的消费日归月）+ 账单核销
待付款 = 应收 − 已付款
```

预付款不计入 FUNDING。勾稽恒等：应收 = 已付款 + 待付款。调减或补偿发券可使待付款为负，仍允许落库。

## 不在本口径

Excel「账单明细」行内已付款 / 待付款 / 结算状态仍走渠道拆分（ADR-0012），与上表不是同一列。账户信息已用信用仍走垫付占用（ADR-0017）。
