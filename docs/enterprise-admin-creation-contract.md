# 后台代办企业账户实现契约 v1

冻结日期：2026-09-30。对应 EAC02；按用户授权暂用建议口径，后续调整同步本文件和两仓 shared 契约。Admin 与 User 保存相同内容；不合并其它 shared 类型。功能实现、联调及发布各自按任务证据验收。

## 产品和权威边界

后台代办 = ADMIN_ASSISTED + admin_offline + ADMIN_WAIVED。无需个人实名、阿里云核验、客户打款、另一轮普通审核或线上确认。自助 = 原有核验、付款和审核。只有完整开通 ACTIVE 映射 SUCCEEDED。个人账户、currentTenantId 和既有资产保留。

review 权限覆盖所有新代办接口及所有运营的已提交记录；未消费临时文件只允许上传运营。旧补救仍是 manage。所有 User 新接口处于 internal/user/admin 内部命名空间，验证 caller=admin-api、专用 token、HMAC 签名上下文的 adminId、permissions、issuedAt 和 requestId。不得公开到用户认证提交路由。

## 接口

Admin 前缀 /api/admin/v2/enterprise-accounts/admin-creations；User 前缀 /api/internal/user/admin/enterprise-admin-creations。新建独立 controller，检查 Nest/Fastify 实际路由注册，不能被既有 :id 吞掉。每个接口 require review。

| 方法及相对路径 | 请求 | 响应 data |
| --- | --- | --- |
| GET capabilities | 无 | enabled、supportedPlane、licenseMaxBytes、uploadTtlSeconds |
| POST owner-lookup | {phone} | {found, owner: null或最小账号摘要, eligible, reasonCode} |
| POST check | {enterpriseName, uscc, ownerUserId?, ownerPhone?} | {available, reasonCode} |
| POST upload-sessions | 空对象 | {id, expiresAt} |
| POST upload-sessions/:id/license | multipart 单字段 file | {id, sessionId, contentType, size, sha256, expiresAt} |
| GET upload-sessions/:id/license/:uploadId/file | 无 | 私有二进制，no-store，不给对象 key |
| POST 根路径 | CreateInput | CreationRecord，默认 SUBMITTED |
| POST resolve | {idempotencyKey} | {found, record: null或CreationRecord} |
| GET 根路径 | page=1,pageSize=20(最大100),status?,requestId?,ownerUserId?,uscc? | {items,total,page,pageSize} |
| GET :requestId | 无 | CreationRecord |
| POST :requestId/retry | 空对象 | CreationRecord |

手机号放 body，不进入 URL 或日志。USCC 查询可在内部请求中使用，Admin UI 检索先精确匹配，不实现加密企业名的模糊查询。列表中不返回完整手机号；需要电话明文仍按原敏感权限路径。capabilities 与服务端校验共同控制启用；每个写入口必须做服务端校验。

CreateInput = {enterpriseName, uscc, ownerUserId, ownerPhone, licenseUploadId, uploadSessionId, idempotencyKey}。企业名称 trim 后2至128字；USCC trim 后必须满足现有18位大写规则 /^[0-9A-HJ-NP-RTUWXY]{18}$/；手机号用现有 normalizeMainlandPhone；ID 有界非空，幂等键为客户端一次操作生成的 UUID。上传类型/魔数/字节上限复用现有文件规则。

CreationRecord = {requestId,applicationId,verificationId,source:'ADMIN_ASSISTED',verificationMethod:'ADMIN_OFFLINE',paymentMode:'ADMIN_WAIVED',enterpriseName,uscc,ownerUserId,ownerPhoneMasked,createdByAdminId,createdAt,publicStatus,provisioningStatus,tenantId,billingAccountId,canRetry,errorCode,errorMessage}。状态由 provisioning 推导，不新增同义状态列。历史转让后的原指定 Owner 是受理快照，不能据此覆盖当前 Owner。

成功外层 {code:0,message:'ok',data:...}；错误按当前 HttpExceptionFilter 使用字符串 code、message、data:null，HTTP 状态保持。当前代码已支持字符串业务错误，不能误称现有错误 code 为数值。Admin 代理必须保留已知业务 code；不把上游错误对象随意原样透传。客户端按 code 定位字段，格式错误 message 可包含字段名，敏感值不进入错误文案。

错误码统一前缀 ENTERPRISE_ADMIN_：DISABLED、INVALID_INPUT、USER_NOT_FOUND、USER_INACTIVE、PHONE_CHANGED、PHONE_AMBIGUOUS、OWNER_CONFLICT、APPLICATION_CONFLICT、USCC_CONFLICT、BILLING_UNAVAILABLE、UPLOAD_INVALID、UPLOAD_UNAVAILABLE、AUDIT_UNAVAILABLE、UPLOAD_EXPIRED、UPLOAD_USED、IDEMPOTENCY_CONFLICT、NOT_RETRYABLE、STATE_CONFLICT、NOT_FOUND。权限及内部签名失败保留现有 AUTH_* 错误。409 表示资格/占用/幂等/状态冲突，400 表示格式及文件校验，404 表示不存在，503 表示配置或依赖不可用。unknown response timeout 是 UI 状态，不落失败业务记录。

## 持久化

1. EnterpriseAdminCreationRequest：唯一 (createdByAdminId,idempotencyKey)，不可变内容 fingerprint；关联唯一 verificationId、applicationId、licenseUploadId、uploadSessionId；原 ownerUserId、ownerPhoneLookupKey 和 phoneMasked、来源、核验/免付款方式、createdAt。企业和执照详情复用受理时认证快照，不额外明文复制。User 物理删除和关联资源删除均 Restrict，普通注销仍是原软删。
2. EnterpriseAdminUploadSession：id、uploaderAdminId、createdAt、expiresAt；默认24小时 TTL（ENTERPRISE_ADMIN_UPLOAD_TTL_SECONDS，范围5分钟至7天）。
3. EnterpriseAdminLicenseUpload：id、sessionId、objectKey(唯一)、sha256、contentType、size、originalFilename、status、uploadedAt、consumedAt、cleanupAttempts、cleanupError、updatedAt。status=UPLOADING/READY/CONSUMED/CLEANUP_PENDING/DELETED。先持久化预留行，再写对象，成功后 READY；进程中断可扫到预留对象。清理只从未消费态 CAS 到 CLEANUP_PENDING，提交只从 READY CAS 到 CONSUMED，禁止清理已消费。
4. EnterpriseAdminCreationEvent：可空 requestId（拒绝时尚无受理记录）、operatorType、operatorId、correlationId、idempotencyKey、action、errorCode、detail、createdAt。detail 仅脱敏关联标识；成功/失败/重试事件与业务状态同事务。请求拒绝另作审计，不在业务事务回滚时丢掉。
5. EnterpriseSubjectClaim：usccKey 为稳定 HMAC 主键、verificationId、userId、claimedAt、releasedAt、releaseReason。当前占用唯一，释放后保留事件历史且受控更新占用行，不删除历史认证。HMAC 使用独立 ENTERPRISE_USCC_HMAC_KEY 与域 ruidong:enterprise-uscc:v1\0；不得复用 phone 盲索引或可逆加密密钥，缺配置关闭新受理。历史扫描通过现有解密读路径规范化后比对；不得用密文 uscc 的明文 where 查询。
6. application 添加可空 creationSource/paymentMode；历史 null 解释为 LEGACY_UNKNOWN，不虚构来源。新自助 writer 明确 SELF_SERVICE/CUSTOMER_TRANSFER；后台明确 ADMIN_ASSISTED/ADMIN_WAIVED。verifyOutcome='admin_offline'，APPROVED 并保存可信运营与时间。paymentAmount、paymentProofFileId、paymentSubmittedAt 保持 null，不能伪造客户已付款。

User新迁移添加型，BEGIN + SET LOCAL lock_timeout='5s' + COMMIT；字段默认兼容旧 writer。模型约束用 Prisma 表达；额外 CHECK 在迁移和真库测试验证，不靠前端代替。Billing只读表达式索引使用单语句CREATE INDEX CONCURRENTLY，不能包事务。未授权执行生产迁移/回填。

## 幂等、锁和受理

固定 fingerprint v1 = SHA256(JSON.stringify([v1,trim企业名,规范USCC,ownerUserId,规范手机号,uploadSessionId,licenseUploadId]))。手机号不直接存 fingerprint 原文。调用权限和格式校验之后先查原运营+键，同摘要直接返回原记录；不同摘要409；回放不再执行动态资格/文件/企业查重。

外部 Billing 查重在事务外，任何依赖失败不返回 available=true。进入事务依序：幂等键事务 advisory lock → USCC claim 事务 advisory lock → users 行锁（转让的双用户仍稳定排序）→ session/upload 行锁。自助按USCC再users；转让只取users及原认证，不反向抢USCC锁。重提改代码同时锁涉及的代码键按排序，避免两代码交换造成死锁。

锁内重新识别幂等回放，读取用户isActive/deletedAt/手机号真值；查询 live认证、非REJECTED申请、未收敛provisioning和企业根Owner。普通member不拦截；已有在途申请拒绝后台覆盖。用户phone/status写操作的 UPDATE 自带 users 行锁；ACTIVE 前再次在同锁内确认账号有效及受理手机号没有变化。

信用代码 claim 与自助共同writer完成前不开新入口。历史代码占用需预扫描和获授权回填；申请占用不替代 Billing 最终唯一性。不存在企业时可占用；同一合法自助认证重提复用；失败/墓碑/停用无自动释放，残留或历史歧义转人工。

同一受理事务：写/获claim → 新 live认证及执照快照 → application APPROVED → 用 CAS 消费upload并创建归正确User的原文件元数据 → PENDING provisioning → request → accepted审计 → 初始 outbox enqueueWithTx。唯一冲突整体回滚，处理重放时再次读原请求。外部 Billing/OSS/阿里云不在事务内。返回受理前 outbox 必须已持久化；不依赖提交后浏览器触发。

enqueueWithTx 是初次入队：唯一 ent-prov:verificationId，已存在返回原行且不修改任何status/attempt/锁/payload；新任务source='enterprise_admin'，step原值。并发upsert空update防同一唯一键竞争，调用方无需独立事务。现有 enqueue/forceRedrive 的旧语义保留，新受理不调用重排方法。

## 开通、审计和恢复

复用 provisioning 各步骤及稳定资源 ID。ACTIVE 前证明 User有效企业根Tenant及Owner成员、Billing有效企业账户/钱包/Owner/attach、User身份和Tenant.billingAccountId一致。错误按暂态/终态分类，未知资源先原verification reconcile；不能新建verification尝试恢复。原个人Tenant/余额/赠额不动，currentTenantId不强切。

PENDING/VERIFYING→SUBMITTED；PROVISIONING→PROVISIONING；ACTIVE→SUCCEEDED（关系异常转人工诊断）；FAILED_RETRYABLE→FAILED_RETRYABLE，但 outbox EXHAUSTED 或回收态不可普通retry；FAILED_FINAL→FAILED_MANUAL；VOIDING/VOIDED对应同名。未知状态或缺开通记录为FAILED_MANUAL，不能成功。

重试受理仅原记录FAILED_RETRYABLE、任务未耗尽、认证未释放/转挂、application仍APPROVED、未墓碑/回收及Owner资格一致；锁住原任务并CAS、审计与重排同事务，两人重试最多一次合法排队。已成功/运行中不重排，终态不能forceRedrive。恢复允许其它review运营操作并留其身份。

受理审计、终态和重试审计必须与User状态同事务。Admin通用日志只作为关联补充。验证拒绝按correlationId、操作者、合法键及脱敏错误码留痕；权限失败沿用安全鉴权日志；数据库不可用无法保证业务审计持久化，应返回不可用，不能受理成功。

## 启用及发布

Billing补充 `POST /internal/billing/admin/enterprise-accounts/subject-check`（有api前缀部署时加/api）。沿用user-api服务token及内部API版本，body仅 `{uscc:规范大写18位代码}`；响应 `{code:0,message:'ok',data:{uscc,occupied,truncated,accounts:[{accountId,type,ownerUserId,verificationId,status,deletedAt,quarantinedAt}]}}`。精确规范代码比对兼容历史大小写及String.trim空白集合，覆盖停用/软删/quarantine和异常非企业类型；最多100条，超出truncated=true。任何匹配都需要阻挡新受理或人工处理，不能因为deletedAt非空视为自由。原列表/detail权限不扩大。无账户墓碑必须按原verification reconcile取得。

User客户端校验主体查询响应结构、代码回显、occupied/accounts/truncated一致性和重复ID；格式异常或依赖故障不当作不存在。历史扫描和幂等回填设计见 `docs/enterprise-subject-audit-and-backfill.md`，目前只有只读工具，没有apply入口。

Billing建账重放和Owner成员初始化在锁内拒绝Owner不一致；User调用attach时，把控制器读取的账户Owner固定到事务内再次核对，拒绝陈旧交接请求。建账返回walletCreated/ownerMemberCreated/attached是本次操作回执，false不表示资源不存在、true也不替代全链路完成核查。重放不自动修补缺失钱包；EAC10/EAC12需读实际资源、按原verification安全恢复。

capabilities.enabled = deploymentConfig.region=domestic且provider=authing + ENTERPRISE_ADMIN_CREATION_ENABLED=true + 安全配置就绪。默认不开启；该开关只阻止新会话/lookup/check/create，不阻止已受理记录查询、resolve及安全retry；临时会话文件读取继续按归属。初始在所有writer及回填未完成前保持关闭。

扩展schema/索引 → 先部署兼容Billing主体查询 → 兼容User共同writer和worker → 授权历史扫描/回填及冲突处理 → 全部旧writer退出 → Admin API/UI → 真链路和UAT验收 → 指定地域获授权启用。User新入口调用前确认Billing新增查询版本已就绪；旧User不用新查询仍兼容。回滚先停新受理，保留数据、文件、审计与恢复能力，只退到能理解新来源和schema的兼容版本。

## 示例

提交：{"enterpriseName":"示例科技有限公司","uscc":"91110000AAAAAAAAAA","ownerUserId":"客户已注册ID","ownerPhone":"13800138000","licenseUploadId":"执照ID","uploadSessionId":"会话ID","idempotencyKey":"123e4567-e89b-42d3-a456-426614174000"}

受理：{"code":0,"message":"ok","data":{"requestId":"请求ID","applicationId":"申请ID","verificationId":"认证ID","source":"ADMIN_ASSISTED","verificationMethod":"ADMIN_OFFLINE","paymentMode":"ADMIN_WAIVED","publicStatus":"SUBMITTED","provisioningStatus":"PENDING","canRetry":false,"tenantId":null,"billingAccountId":null}}

冲突：HTTP409 {"code":"ENTERPRISE_ADMIN_USCC_CONFLICT","message":"企业已有开户记录或在途申请，请先处理原记录","data":null}

未知结果：POST失败→以原键resolve；found=true显示原状态，found=false使用原键及原内容重发；resolve也失败保持待确认。刷新仅保存requestId或幂等键，不把完整手机号、表单或执照写localStorage。

## EAC05 / EAC06 实现补充（2026-09-30）

共同保护默认关闭：ENTERPRISE_SUBJECT_CLAIMS_ENABLED 与 ENTERPRISE_SUBJECT_CLAIMS_READY 均 true，独立 USCC 密钥、全部 writer 升级、历史获授权回填及 Billing 查询部署就绪后才启用。缺历史 claim 或改码无法证明安全时转人工，不自动释放。PHONE_AMBIGUOUS 是新增的稳定歧义码。详情及完整 writer 清单在 User docs/enterprise-subject-writers-and-lifecycle.md。

目前只实现 User capabilities / owner-lookup / check；check 成功返回 available=true，资格/占用冲突按409结构化业务码拒绝，依赖失败503，不返回可用结论。未实现 Admin 代理、上传或完整受理。

## EAC07 / EAC08 实现补充（2026-10-07）

User已实现运营上传会话、单file严格上传和私有二进制读取；新增write/cleanup租约、cleanupDueAt及周期复查删除墓碑，消费后不清理。会话到期使用DB锁后clock_timestamp，文件限制与capabilities共享，存储桶/前缀/根目录保持一致。清理独立ENTERPRISE_ADMIN_CLEANUP_ENABLED，默认false。

消费能力consumeWithTx要求同一受理事务内已有request，验证运营/Owner/认证/会话/文件；EAC09应先锁文件，再在未提交事务内建立request并消费，所有业务/审计/outbox一起提交。这是接口能力，不是完整受理已完成。

事件增加nullable dedupKey/fingerprint，旧事件保留；审计幂等键字段存UUID摘要。拒绝审计、可信身份/稳定关联、日志与遥测脱敏已接线；DB审计失败返回503 AUDIT_UNAVAILABLE，不假称记录成功。对象依赖错误为UPLOAD_UNAVAILABLE。详情见User docs/enterprise-admin-files-and-audit.md。Admin代理/页面、完整受理及开通完成判定仍未实现。

## EAC09 / EAC10 实现补充（2026-10-07，第五批）

以上任务补充是对应批次的历史快照。本批User已实现POST根202事务受理、GET记录/分页、POST原运营原键resolve，以及原worker完整成功闸门。Admin仍仅同步契约，未实现代理或UI。原记录retry/人工处置及完整巡检恢复属于EAC11/12。

幂等事务按原运营+键门闩->共同USCC->users->认证/claim->session/upload保存认证、claim、免付款已APPROVED申请、request/执照消费、PENDING、ACCEPTED和初次outbox；失败整体回滚。POST同内容重放不重做动态Owner/TTL/Billing，也不修改任务，关闭新受理仍可恢复。POST只返回本地原记录，GET/resolve/list核实最新资源。

代办复用原outbox，每次执行独立claimToken；User状态事务在users/job锁下复核资格及execution。ACTIVE前事务外获取Billing完整证明，事务内再次复核User资源后同事务写ACTIVE、根Tenant.account、identity、completionVerifiedAt/proof v1和关键审计。旧worker不能覆盖新job或ACTIVE/回收态。历史回执缺失不能把代办ACTIVE自动宣称成功。

Billing新增最小只读POST enterprise-accounts/provisioning-proof，输入verificationId/accountId/tenantId/ownerUserId；返回有界引用、观察时间、独立墓碑、全历史账户数、指定账户/钱包存在性/Owner成员/指定Tenant及其Owner成员/挂载。READ ONLY REPEATABLE READ，无资金/联系方式，原GET详情权限不放宽。User严格响应验证，缺实际资源用新增RESOURCE_INCOMPLETE码；响应故障/矛盾503 BILLING_UNAVAILABLE。该码两仓shared一致，属兼容添加。

查询SUCCEEDED要求本地完整关系和已保存回执，并重查Billing当前证明；资源漂移显示FAILED_MANUAL，依赖故障503，均不改写历史ACTIVE。受理Owner快照不覆盖转让后的当前Owner。列表状态筛选验证真实资源，最多10000候选，超过拒绝统计而非截断total；跨服务列表不是全局原子快照。canRetry只是本地候选，EAC11端点还须外部对账及锁内复核，不是已有重排授权。

完整边界见User docs/enterprise-admin-admission-and-completion.md。没有个人Tenant/余额/权益迁移、currentTenantId强切、通知、赠额、Key或授信。Billing全历史迁移、两仓既有根检查失败和目标环境/UAT/发布门槛仍保留。

## EAC11 / EAC12 实现补充（2026-10-07，第六批）

User已实现strict空对象POST :requestId/retry及:requestId/recover；review覆盖其它运营，body不接受改挂字段，停新建仍可恢复。新增GET :requestId/recovery、GET recovery-inspection（limit默认20最大100，afterRequestId UUID）只读报告；lookahead/hasMore/nextCursor/complete/scope明确有限覆盖。Admin仅同步此契约，代理/UI未接。

CreationRecord兼容添加optional recovery={kind,reason,message,action}；恢复报告为request/verification/application/原Owner/当前Owner/Tenant/account/observedAt及decision，无完整电话/objectKey/payload/资金。GET canRetry采用实际原verification外部资源政策，只有RETRY为true；UNKNOWN明确不授权，POST重放保守false且不重新访问依赖。

动作幂等用可信签名correlationId+operator+action+业务requestId的审计回执；网络重发同动作保持该ID，新动作生成新ID。状态/排队/关键审计同事务，同次提交后响应丢失可重放而不重排。资料/Owner/原创建键/文件不更换，预算不清零。

代办attempts在执行领取事务持久加1并写OUTBOX_CLAIMED，中断也消耗预算，失败结算不二次累加；原自助计数不变。原payload/ID/来源和执行token绑定原job，旧结果不能覆盖成功/回收/新执行。旧enqueue/redrive/start/reentry/retry拒绝代办源，旧manage回收权限不扩大。

仅原FAILED_RETRYABLE、任务非执行/成功/耗尽、Owner/手机/claim/APPROVED免付款/已消费文件/受理证据一致、原资源可安全复用时普通retry。补缺job仅尚未执行的PENDING完整受理且无本地/下游历史；无法证明累计预算转人工。完整ACTIVE未结算任务可只结算原job，不重跑资源步骤，按当前Owner核实，不覆盖转让。钱包缺失/资金不明、墓碑、多账户、归属变动、错误挂载/停用/回收均不自动修复。

详见User docs/enterprise-admin-retry-and-recovery.md及第六批执行证据。没有Admin代理/前端、生产巡检apply或发布；Billing业务资金代码未改，原全迁移及其它基线失败保留。

## EAC14 实现补充（2026-10-07，第七批）

Admin已接独立review proxy及全部已实现User接口，旧V1/V2与client合同保留，无前端。新增两端GET :requestId/license-file，User按原request定位verification并复用原认证私有读，不依赖Billing当前完整性；临时文件归属不扩大，无公共URL/key。

Admin新namespace普通请求生成/保留有效X-Request-Id UUID，非法头400；retry/recover必须显式稳定UUID，同动作网络重发保留，新动作换UUID。身份/DB或缓存权限进入服务器签名，不采信浏览器服务头/body管理员。

专用client保留已知业务码/HTTP/data:null，以安全message返回；未知/超时/malformed不泄漏原body或确定失败。原始multipart byte/boundary透传、路由独立文件max+1MiB，普通JSON不扩大；二进制有界读、取消/超限cancel、安全类型/长度/头、no-store/nosniff/sandbox，User最终验magic/size。

Admin副日志只安全引用/UUID/静态phase/错误，故障不改已202事实；Pino/Sentry去电话/文件/key/签名/SDK详情。详情见Admin docs/enterprise-admin-proxy.md及第七批证据。默认创建门槛、旧失败、前端/实网/UAT/发布边界仍保留。

## EAC17 / EAC18 读取补充（2026-10-08，第九批）

新增review GET :requestId/history：query limit默认20最大100，beforeId UUID/beforeAt ISO成对，operationId可选UUID，strict拒绝未知字段。返回items/hasMore/nextCursor/scope=REQUEST_AND_ORIGINAL_KEY。事件仅原request或空request下可信原运营+原创建键SHA256关联的失败；READ ONLY REPEATABLE READ，不依赖Billing或对象。必要动作/时间/运营及操作UUID/白名单码/状态次数，没有detail、联系方式、创建键/摘要、fingerprint、objectKey、payload、claimToken或服务凭据。成功不写审计，失败沿原拒绝审计。

旧认证快照附加nullable creationSource/verificationMethod/paymentMode，取自原申请，历史null不推断；Admin按Billing原verificationId识别同用户当前/释放历史。仅展示补充，不改变自助付款/审核/开通及释放规则。

Admin UI按原requestId GET核实成功、有限退避、原运营原键resolve；found=false/依赖故障继续未知。retry/recover原空对象及稳定UUID X-Request-Id不变，未知重发同UUID，202仅动作受理。最小opaque持久化、回执查询及迟到标识保护；记录/结果在新建关闭后可用。此补充不是生产启用、EAC19/20正式验收或UAT证据。
