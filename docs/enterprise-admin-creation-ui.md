# 代客创建前端：EAC15 / EAC16

2026-10-07，本地实现。完整状态/原键恢复/原记录重试 UI（EAC17）及代办记录/详情（EAC18）尚未实现；本说明不代表上线或 UAT。

## 入口和权限

`/enterprise-accounts-v2/admin-create` 是独立 lazy 路由，精确匹配 review 权限，优先于原 `:id` 详情模式。菜单及 V2 页动作分别用服务端 capabilities 控制新入口，默认隐藏、依赖错误不开启。原「创建 / 补救」继续使用 manage 和原 Modal/API。

review-only 可直接使用新页及 API，不要求 users.view/manage；既有 expandAdminPermissions 会补企业 view，默认首页沿用原顺序。manage-only/普通/未登录不能直达新创建页，服务端仍独立鉴权。新建关闭不隐藏本页已保存的 ACCEPTED/UNKNOWN 上下文。后台可信身份/签名完全由代理产生。

现有 Admin 纸色/AntD 组件，两列在 800px 以下变单列。返回/取消保留原 URL 查询；审核队列的 reviewStatus/reviewFinal/reviewPage/reviewPageSize 现以 URL 保存，原默认待审核和 FINAL 查询语义保留。未提交离开仅丢弃本地表单，没有创建业务记录。

## 文件和账号选择

企业名 trim 后 2–128 位；USCC trim 后严格 18 位大写允许字符，不自动把小写转为合法大写。通过两仓既有 shared schema 和导出的 normalizeMainlandPhone 校验。

选择执照先清掉旧文件和确认，按 capabilities 大小/期限预检；单个原生 multipart file 经 session -> upload，元数据包含 session/id/hash/size/type/expiry。只有最新上传序号可写回；移除、替换、卸载 abort，迟到结果即使忽略 abort 也不能复活旧文件。失败上传不留可用文件，未受理对象留给已有 User 清理服务。

私有预览 GET 返回 Blob，不暴露 objectKey/存储 URL；读取内容类型/长度匹配所选文件，Blob URL 在关闭/替换/卸载释放。PDF 使用 sandbox iframe。不存在/过期/已消费/不可读要求重新上传，不前端消费或删除原对象。

手机号精确 POST 查询，规范手机与选定 userId 绑定；只显示 nickname/userId/脱敏电话/资格原因，不要求或展示个人实名状态。每次手机号输入变化即清空旧选择和确认。lookup 序号独立保护，等待/错误/未匹配不能确认。未注册/停用/注销/映射歧义/已有 Owner 或企业主体/在途申请按实际 User 结果拒绝；不自动注册，普通 member 不自行等同 Owner。

## 核对与幂等生命周期

| 阶段 | 键及内容 | 允许动作 |
| --- | --- | --- |
| 草稿 | 只在内存；无创建 POST | 录入、上传、查人、取消 |
| 咨询/核对 | shared 解析后的 frozen snapshot + UUID 创建键 | check 仅咨询；任何字段/Owner/文件修改使核对失效 |
| 已发送 | 同一 frozen 内容 + 原 UUID，同步 latch 防连点 | 禁止编辑或第二次创建；离开不取消已受理事实 |
| 明确拒绝 | 仅白名单 400/409 前置业务拒绝，可清本次 marker | 定位字段，清掉已失效 Owner/文件；修改后重新核对产生新的逻辑键 |
| UNKNOWN | 保留原创建键；网络/未知封套/5xx/幂等冲突/权限异常均保守锁定 | 显示待确认，不换键；EAC17 接原键 resolve |
| ACCEPTED | 保存原 requestId/创建键；忽略响应的开通状态 | 202 只显示已受理；显式「创建另一家企业」才清本次标识及全部表单 |

所有编辑用 revision 使旧 check/确认失效；上传/查人仍有各自 seq。提交使用确认快照，不重新从可变表单读取。真正资格/主体占用/文件消费/审计/outbox 原子性由 User 再次核验。

创建标识先写 localStorage，再发 POST；无法持久化则不发送。按真实运营 ID 分区，持久化仅 `{state,idempotencyKey,requestId?}`，不保存手机号、企业资料、执照/文件名/引用/hash 或服务凭据。重新进入、刷新、其它标签页已有 pending 会阻止第二个逻辑操作。其它标签页的同步写入并非浏览器全局原子锁；最终同主体/Owner/幂等竞争由 User 数据库保障。删除浏览器存储不是恢复业务的合法手段。

明确拒绝后删 marker 失败仍 fail closed；202 后写 ACCEPTED 失败，先前 UNKNOWN marker 仍可在刷新后保护原操作。响应晚于卸载仍保存 ACCEPTED，前端不对 User 请求/CONSUMED 文件做回滚。坏的本地 marker 保守阻止新建，EAC17 需提供可核实的恢复指引。

API 层独立 credentials transport、有界 timeout、有效 UUID X-Request-Id，保持已知业务码/HTTP及固定安全中文说明，异常不保留 Axios config/raw body。每个普通 HTTP 尝试头与 body 创建键分开。未来 retry/recover 须扩展为显式稳定操作 UUID，当前未实现这些 UI/客户端动作。202 必须是合法 envelope/requestId/source；200/201、APPROVED/VERIFIED/形似 SUCCEEDED 均不作为成功。

## 验证和边界

第八批需求执行记录及 batch-08 留存原失败、JSON/日志/数据库迁移、浏览器截图。UI 受控结果验证乱序/错误及快照；真实 localhost Admin JWT/DB 权限 -> User 签名/事务/本地对象 -> Billing HTTP 另证实际行为。Admin cache、Billing Publisher/cache、JWT issuer/profile 为测试替身，不能称 IdP 登录/OSS/S3/已部署环境/UAT。

`scripts/test/enterprise-admin-browser-http.fixture.cjs` 只接受显式 localhost owned `eac_admin_test` 和本地 User；控制接口有独立测试 token，处于 Admin runtime plane，无全局关闭 auth。`playwright.enterprise-admin-owned.config.ts` 与独立目录 E2E 不进入原默认 e2e/admin；需要专属 output、连接和已装 Edge。夹具不是生产启动入口。

EAC17 继续接 GET requestId/POST resolve、退避轮询、原记录 retry/recover 和可靠人工指引；EAC18 继续记录分页、来源和必要审计读取/执照详情。已有后端失败、生产历史回填/全部 writer 和独立密钥配置门槛、实际对象存储及发布/UAT仍单独验收。
