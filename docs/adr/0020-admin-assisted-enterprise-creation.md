# 企业账户 V2 增加按审核权限隔离的后台代办入口

Status: accepted for implementation, 2026-09-30；产品后续反馈可修订。

企业账户 V2 增加独立后台代办创建页、提交前核对和代办记录入口。原型仅说明业务意图，布局沿用现有 Admin 组件（ADR-0010）。原创建补救继续面向已有认证，保持 `admin.page.enterprise_accounts.manage` 权限和既有路由，不与新功能合并。

新代办的查询、手机号精确查找、执照上传、创建和条件内重试均要求 `admin.page.enterprise_accounts.review`。仅有 review 的运营可以完成该流程；不附加 users.view 或 manage 权限，也不获得旧充值、授信等操作权限。临时文件另受上传运营归属约束。

Admin API 验证真实管理员后，以现有签名上下文代理 User 内部管理接口。前端声明的 operatorId 不可信，Admin 不直接访问 User/Billing 数据库或对象存储。运营线下核实，不调用阿里云企业二要素；客户无需个人实名、打款、线上确认或额外材料。自助认证原规则保持。

HTTP 受理成功只代表已保存请求及持久化任务。结果页按原 requestId 查询；完整企业开通 ACTIVE 才显示成功。超时用原幂等键 resolve，查询不可用时保持结果待确认，不新生成键创建第二条。失败仅原记录重试，终态冲突转人工。

新代办列表与自助待付款/待审核队列分开。新入口在 domestic/authing 平面及服务端启用配置允许时展示；详情等旧功能仍核对其原权限。个人数据及企业账务功能不因新增入口调整。

实现契约见 [契约](../enterprise-admin-creation-contract.md)。本 ADR 不表示功能已上线，生产发布目标与业务数据操作另行授权。

2026-10-07第七批：EAC14接入独立15路由proxy、实际JWT/review、可信服务器签名及稳定UUID操作头、专用结构化错误/有界multipart与二进制和脱敏副日志。User补最小requestId执照私读以避免依赖Billing当前状态，权限仍review。详见 [代理说明](../enterprise-admin-proxy.md)。无前端/生产数据/发布。

2026-10-07第八批：EAC15/EAC16 独立创建页及 review/capabilities 入口、会话执照/私有预览、手机号精确选择和序号防乱序、核对快照及固定 UUID 受理提交完成本地验证。202 仅已受理，未知结果最小 opaque marker 阻止重复创建；EAC17/18 完整结果/恢复及记录仍未开始。详见 [前端说明](../enterprise-admin-creation-ui.md)。不表示部署/UAT。

2026-10-08第九批：EAC17/18 接入原键结果找回、有界退避查询、稳定UUID原记录retry/recover、独立代办记录/详情、审计只读和原执照私读。旧认证快照按原verification识别真实代办来源，成功仍只认已核实GET；未知不换键。见 [结果与记录](../enterprise-admin-results-and-records.md)。未开始正式EAC19/20或UAT/发布。
