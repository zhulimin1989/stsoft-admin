# EAC14：后台代办 User 代理

2026-10-07，本地实现与限定验证，无前端、生产数据/apply或发布。

## 路由、权限与操作ID

AdminModule注册独立EnterpriseAdminProxyController/Service，外部/api/admin/v2/enterprise-accounts/admin-creations，User内部原前缀。实际globalPrefix/URI VERSION_NEUTRAL和旧V2动态:id共存，真实HTTP证明新段不会被吞；旧controller及client响应合同保留。

15个路由逐方法声明review，真实Cookie AdminJWT验签、AdminMember状态及Admin DB/原缓存权限。review-only且无manage/users.view可用，manage-only、普通/停用/无效/缺管理JWT拒绝。body/浏览器permissions/服务头不作权威；Admin不直连User/Billing数据库。

代理capabilities、owner/check、upload-session/严格单file上传/临时私读、POST202/resolve、分页/详情、retry/recover/recovery/inspection。新增两端GET :requestId/license-file，User按原requestId解析verification，复用原VerificationService私有读，不依赖Billing当前开通证明；其它review可读受理后执照，但不能借此读他人未消费会话。无对象key/公共URL。

新namespace仅允许有效X-Request-Id UUID并返回；普通请求缺头生成UUID，非法/多值头拒绝400。POST retry/recover必须显式稳定UUID：同动作网络未知重发保持，新主动动作换ID。创建仍用body原幂等键，未知结果用原运营原键resolve。真实身份/权限进入现有AsyncLocalStorage，以服务器token/caller/版本/HMAC签名向User传递，浏览器服务头忽略。CORS暴露安全X-Request-Id/Content-Disposition。

User的202/原ID/canRetry/recovery/UNKNOWN/成功判定为权威；Admin不自行查Billing、改Owner、排Worker、补钱包或解除墓碑。capabilities仅代理，不改enabled；关新建仍可查询、合法恢复和私读。

## 专用传输与文件

UserInternalClient新增enterpriseAdminRequest/Upload/File，不改旧request/requestBinary。shared/UUID strict输入，phone只body。已知ENTERPRISE_ADMIN_*及AUTH/格式码保留HTTP/data:null，message固定安全文案；未知HTML/SDK/malformed/非零成功封套/超时/重定向安全503，不泄漏原body/stack/服务签名或声明确定业务失败，不自动重发写请求。

JSON成功最多2MiB，错误128KiB，二进制按capabilities及Admin配置较小上限逐chunk有界累计，超限cancel；调用方abort与内部timeout合并，实际HTTP取消验证。只允许jpeg/png/pdf，错误HTML拒绝，Content-Length完整匹配。文件在有界内存中转，目标并发容量另验。

仅这组上传路由注册buffer multipart parser及文件max+1MiB，默认10MiB、配置ENTERPRISE_VERIFY_MAX_FILE_BYTES；原普通JSON上限不扩大，其它路由不新增上传。原始bytes/boundary完整透传，User最终检查single-file/magic/MIME/size，不字符串化/JSON化文件。

私读安全类型/文件名/实际长度、no-store/nosniff/sandbox，不返回对象URL。requestId私读最小User适配解决“ACTIVE查询依赖Billing完整性、故障阻断原执照”的实际缺口，仅review、无新资料/资金动作。

## 审计与遥测

专用Admin副日志仅adminId、UUID操作ID、必要业务/verification/session引用、静态phase及白名单错误；不存phone/表单/图片/objectKey/凭据/before/after/IP/UA。异步写失败静态告警，不撤销User提交事实，不构造跨库事务。User关键审计仍权威。

Pino新路径去query/任意ID、无效requestId安全化，redact电话及服务token/context/signature。Sentry新namespace去request资料/user/extra/breadcrumbs/locals/span数据及原异常，只留静态路由/通用错误/trace；纯路径函数无Nest/runtime依赖，维持启动加载时序。新namespace Fastify与Nest包装413/415统一UPLOAD_INVALID，未知异常静态日志，旧namespace行为保留。

## 验证与剩余门槛

真实Admin JWT/数据库权限→签名User事务/文件/Worker→真实Billing HTTP/controller/service/DAL，独占PostgreSQL及local对象。JWT为本地测试issuer，Admin缓存、Billing Publisher/cache为替身，不代表真实IdP/部署链路/UAT。

4194312与5242880字节实际通过Admin→User保存→私读，长度及Buffer.equals完整验证；max+1、空/magic/MIME/额外字段/多file/巨大Content-Length精确拒绝。首轮包装413及版本拒绝码误预期保留日志，没有增加timeout/缩小文件或只断言状态。

仍需两服务文件上限/存储/签名配置一致、兼容新增私读路由、全部writer与获授权历史回填准备。默认关闭创建，前端EAC15-18/正式EAC19-20/目标容量/IdP和OSS/S3实网/UAT/生产发布后续；原User迁移锁/fixture及Billing边界/全迁移失败单列。
