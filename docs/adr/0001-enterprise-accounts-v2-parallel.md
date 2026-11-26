# 企业账户 V2 与旧实现并行，只切菜单入口

旧列表、抽屉详情、`/enterprise-accounts` 与 `/admin/enterprise-accounts` 全部保留不动。新 UI 走 `/enterprise-accounts-v2`，新 API 走 `/admin/v2/enterprise-accounts`。线上入口只把「用户运营 / 企业账户」指向新路由；回滚时把菜单改回旧路由即可。

不把信用额度、发票、促销码、按量账号并进本菜单。列表按 PRD §3 在 V2 重做，旧列表原样保留。

允许改动的旧文件仅限入口接线：`AdminLayout` 菜单与懒加载、`app.tsx` 新增 `/enterprise-accounts-v2`（旧路由保留）、`permissions.ts` 把新 path 映射到现有 `admin.page.enterprise_accounts.*`。旧页面、旧 controller、旧 client 行为不改。
