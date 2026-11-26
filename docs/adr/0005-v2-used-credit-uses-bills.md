---
status: superseded by ADR-0017
---

# V2 已用信用改用账单口径

V2 详情的已用信用曾定为当期未出账消耗 + Σ 待付款。代码与 ADR-0017 已改回 V1 垫付占用；账单汇总仍会算出一份 `usedCents`，但 Admin V2 不用它覆盖账户信息。
