import { ADMIN_PERMISSION_KEY } from '../common/decorators/admin-permission.decorator';
import { AdminController } from './admin.controller';

/**
 * 配额模板页三个运行时开关（滚动配额 Gate / R3b 月度补发 / R6 终态负额结算）的权限元数据回归。
 *
 * 背景（线上故障）：本 BFF 早期给月度补发与负额结算用了 `admin.plans.view/manage`，
 * 而同页的滚动 Gate 与 billing 侧用的是 `admin.page.coding_quota_templates.view/manage`。
 * 权限隐含关系是**单向**的（`admin.plans.view` ⇒ `admin.page.coding_quota_templates.view`，
 * 反向不成立），于是只勾了细粒度页面权限的角色：能进配额模板页、Gate 卡正常，
 * 但 R6 卡的两个 GET 被本 BFF 挡成 403，前端统一兜底成「billing 内网调用失败，请重试」——
 * 表现为「有些账号报错、其他账号不报错」，且重试永远不会成功。
 *
 * 因此三个开关必须共用同一套权限码，任何一处漂移都要在这里断言失败。
 */
describe('AdminController 自营开关权限元数据', () => {
  const permsOf = (method: string): string[] | undefined =>
    Reflect.getMetadata(
      ADMIN_PERMISSION_KEY,
      (AdminController.prototype as unknown as Record<string, unknown>)[method] as object,
    );

  const VIEW = 'admin.page.coding_quota_templates.view';
  const MANAGE = 'admin.page.coding_quota_templates.manage';

  it('三个开关的 GET 统一用配额模板页 view 权限', () => {
    expect(permsOf('getRollingQuotaGate')).toEqual([VIEW]);
    expect(permsOf('getCodingPlanMonthlyRefresh')).toEqual([VIEW]);
    expect(permsOf('getSelfopNegativeDeduct')).toEqual([VIEW]);
  });

  it('三个开关的 PUT 统一用配额模板页 manage 权限', () => {
    expect(permsOf('setRollingQuotaGate')).toEqual([MANAGE]);
    expect(permsOf('setCodingPlanMonthlyRefresh')).toEqual([MANAGE]);
    expect(permsOf('setSelfopNegativeDeduct')).toEqual([MANAGE]);
  });
});
