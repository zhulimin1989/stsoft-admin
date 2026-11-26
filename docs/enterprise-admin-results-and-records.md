# EAC17 / EAC18：原请求结果、恢复动作及记录

2026-10-08，本地实现和专属验证。没有生产数据、发布、UAT；EAC19/20正式矩阵未开始。

## 路由、权限和查询

- `/enterprise-accounts-v2/admin-creations` 是独立代办记录页，`/enterprise-accounts-v2/admin-creations/:requestId` 是原记录结果/详情页。精确 review 权限，优先于旧 `:id`；侧栏、V2、新创建页和结果页均有返回/记录入口。新建关闭时记录、结果、原键 resolve、history、原记录动作和私有执照仍可使用。
- 原 manage 创建补救、财务和作废操作保留原权限。财务详情链接另核 view。原待审核/待付款队列与代办记录分开，没有重写金额或原列表列。
- 列表按服务端 page/pageSize/status/requestId/ownerUserId/uscc 查询/total，失败显示“未能核实”，不假装空列表或在前端另算 total。`acPage/acPageSize/acStatus/acRequestId/acOwnerId/acUscc` 保存在 URL，与原 `tab/q/page/pageSize/review*` 共存，返回保留筛选及页码。
- 受理 Owner/脱敏手机始终标注快照。当前 Owner 从有时间标识的 recovery 报告读取，不把转让后的原 Owner 改回。认证旧详情按 Billing 原 verificationId 选择 User 快照，避免同用户已释放历史优先；原接口未给 verificationId 时保留旧选择行为。

## 成功与未知

结果只用 GET 已核实的公共状态：SUBMITTED、PROVISIONING、SUCCEEDED、FAILED_RETRYABLE、FAILED_MANUAL、VOIDING、VOIDED。客户端严格检查来源/免付款、原 requestId、状态及必要成功资源标识；202及原 POST重放上的状态不作为成功证明。

`useVerifiedRecord` 每条请求/每个运营独立序号和 abort。非终态退避2/4/8/16/30秒，最多20次自动成功查询；错误退避并最多5次，401/403/404停止；SUCCEEDED/两种失败/VOIDED停止，VOIDING继续。切换、刷新、卸载阻止迟到结果，手动刷新开启新一轮。查询失败隐藏当前成功及动作资格，可以明确显示上次已核实状态/时间；没有把依赖不可用当业务失败。

创建 UNKNOWN 按原运营+原创建键自动/手动 resolve，最多10次退避，权限失效停止。found=true核对运营后保存原requestId并进入结果；found=false仅此刻未查到，继续冻结原键，不重新开户。刷新没有原表单，不构造 body重发；损坏marker提供人工核查指引。现有 ACCEPTED 页有自然“查看开通结果”入口，保留202已受理反馈。

## 原动作 UUID

retry仅实际GET canRetry及RETRY政策显示；recover仅REPAIR_MISSING_JOB/SETTLE_ACTIVE显示受控动作。发出前再次GET recovery咨询，服务端写事务继续复核；UNKNOWN不派新动作，MANUAL只给核查/原权限管理指引，不提供补钱包/解墓碑/改Owner/清预算/强排。

`admin.enterprise-action.v1.<operatorId>.<requestId>` 只保存 `{requestId,action,operationId,state}`。新主动动作独立UUID；同次未知重发保留原UUID，由 X-Request-Id传到现有服务器签名。与 body创建幂等键分开。同步latch、保存UNKNOWN在POST前；不能保存就不发送。202只动作受理并刷新GET，不把原任务/文件/预算重新创建。

UNKNOWN可以查询原operationId的真实history回执，RETRY_QUEUED/RECOVERY_JOB_REPAIRED/SETTLED为已受理；同运营的拒绝回执且该段完整可识别拒绝。没有回执/依赖未知继续保留，重发原动作也先核实当前状态，不自行生成新UUID。晚到HTTP/回执提交前比对本地当前operationId，不能覆盖其它标签页的新标识；咨询期间新marker出现也阻止第二个动作。浏览器存储不是全局原子锁，最终竞争和动作去重仍由User事务/审计保证。

## 读取缺口与审计边界

新增 `GET /api/admin/v2/enterprise-accounts/admin-creations/:requestId/history` -> User同名内部入口，review及原可信签名边界。

query：limit默认20最大100；beforeId UUID和beforeAt ISO成对；operationId可选UUID；strict拒绝其它字段。User READ ONLY REPEATABLE READ读取原request及事件，不访问Billing/对象、不改变业务资源。scope为REQUEST_AND_ORIGINAL_KEY：本request事件，加未关联request但可信原运营/原创建键SHA256相同的失败尝试。其它运营同摘要、无可信关联的鉴权/查验事件不嫁接到本记录。

按createdAt desc/id desc、limit+1返回 hasMore/nextCursor和明确scope，不称本段是全局审计。响应只有事件ID、动作、时间、operator类型/必要ID、安全操作UUID、白名单错误码和必要状态/次数。没有raw detail、phone、USCC HMAC、原创建键/摘要、fingerprint、payload、objectKey、claimToken、服务凭据。未知动作/码保守归类，不展示数据库原始内容。成功读取不写审计；拒绝沿原失败审计机制，不新增业务writer。

User旧认证快照最小增加 nullable creationSource/verificationMethod/paymentMode，实际来自原申请；历史null不冒充自助/代办。旧V2识别ADMIN_ASSISTED，按真实方式显示线下核实/免客户打款，冲突/缺字段显示待核实，不推导成功或追加客户付款动作。

## 执照和副日志

原record执照使用既有`:requestId/license-file`，review跨运营，User原verification定位，不依赖Billing当前proof。读取capabilities仅获得大小，不以enabled拒绝原文件；客户端有界Blob/MIME校验、sandbox PDF，关闭/卸载/换scope取消并revoke。不存在/权限/依赖错误有受控反馈。

新UI Sentry事件/事务只保留安全静态路径、基本时序及通用错误；移除query/body/header/user/extra/上下文/原始异常值、变量、日志与敏感span数据。Replay继续mask全部文本/输入、block全部媒体；不影响其它页的既有事件策略。Admin history副日志仍原服务器关联，不替代User关键审计。

## 证据和未验证

需求目录第九批记录和batch-09区分受控UI、真实localhost JWT/DB/review/签名/HTTP/Worker、SELECT-only数据库角色和浏览器。Issuer/profile、Admin cache、Billing Publisher/cache为替身，未使用IdP/实网对象/UAT/生产数据。没有新迁移、Billing代码或资金业务变更。

旧User迁移锁/TenantRepository夹具、Billing边界/PG16历史迁移失败保留。正式历史升级/全矩阵、真实购买/个人资产与自助全链路、目标规模/配置回填、对象存储/UAT/发布继续按EAC19以后单独验收。
