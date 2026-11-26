import { describe, expect, it } from 'vitest';
import { expandAdminPermissions, resolveAdminPermissions } from '@ruidong/shared';
import {
  PAGE_PERMISSION_GROUPS,
  ROUTE_PERMISSIONS,
  getDefaultAdminRoute,
  getRoutePermission,
  hasRoutePermission,
} from '../permissions';

describe('route permissions', () => {
  it('normalizes query strings and trailing slashes', () => {
    expect(getRoutePermission('/users/?tab=profile')).toBe('admin.page.users.view');
  });

  it('matches detail routes and protects create routes with manage permission', () => {
    expect(getRoutePermission('/models/model-1')).toBe('admin.page.models.view');
    expect(getRoutePermission('/models/new')).toBe('admin.page.models.manage');
    expect(getRoutePermission('/grant-rules/new')).toBe('admin.page.grant_rules.manage');
    expect(getRoutePermission('/plans/plan-1')).toBe('admin.page.subscription_plans.view');
    expect(getRoutePermission('/plans/new')).toBe('admin.page.subscription_plans.manage');
  });

  it('keeps leaf page grants isolated while retaining legacy compatibility', () => {
    expect(hasRoutePermission('/users', ['admin.page.users.view'])).toBe(true);
    expect(hasRoutePermission('/users', ['admin.page.orders.view'])).toBe(false);
    expect(hasRoutePermission('/booster-packs', ['admin.page.subscription_plans.view'])).toBe(false);
    expect(hasRoutePermission('/finance-reconciliation', ['admin.page.finance_reports.view'])).toBe(false);

    expect(hasRoutePermission('/users', ['admin.users.view'])).toBe(true);
    expect(hasRoutePermission('/coding-plan/self-managed-plans', ['admin.plans.view'])).toBe(true);
    expect(hasRoutePermission('/coding-plan/third-party-plans', ['admin.plans.view'])).toBe(true);
    expect(hasRoutePermission('/coding-plan/resale-report', ['admin.orders.view'])).toBe(true);
    expect(hasRoutePermission('/finance-export-jobs', ['admin.revenue.view'])).toBe(true);
    expect(hasRoutePermission('/unknown', [])).toBe(true);
  });

  it('maps each CodingPlan workspace to its own page permission', () => {
    expect(getRoutePermission('/coding-plan/design')).toBe('admin.page.coding_self_managed_plans.view');
    expect(getRoutePermission('/coding-plan/self-managed-plans')).toBe('admin.page.coding_self_managed_plans.view');
    expect(getRoutePermission('/coding-plan/third-party-plans')).toBe('admin.page.coding_third_party_plans.view');
    expect(getRoutePermission('/coding-plan/resale-config')).toBe('admin.page.coding_resale_config.view');
    expect(getRoutePermission('/coding-plan/resale-report')).toBe('admin.page.coding_resale_report.view');
    expect(getRoutePermission('/coding-plan/quota-templates')).toBe('admin.page.coding_quota_templates.view');
  });

  it('lists every real page independently and protects every declared route with a page atom', () => {
    const pages = PAGE_PERMISSION_GROUPS.flatMap((group) => group.pages);
    const pageKeys = pages.map((page) => page.key);
    const viewPermissions = pages.map((page) => page.view);

    expect(pages).toHaveLength(56);
    expect(new Set(pageKeys).size).toBe(pageKeys.length);
    expect(new Set(viewPermissions).size).toBe(viewPermissions.length);
    const routedPageKeys = new Set(
      Object.values(ROUTE_PERMISSIONS).map((permission) => permission.split('.')[2]),
    );
    expect(routedPageKeys).toEqual(new Set(pageKeys));
    for (const permission of Object.values(ROUTE_PERMISSIONS)) {
      if (permission === ROUTE_PERMISSIONS['/enterprise-accounts-v2/admin-create']) {
        expect(permission).toBe('admin.page.enterprise_accounts.review');
      } else {
        expect(permission).toMatch(/^admin\.page\.[a-z0-9_]+\.(view|manage)$/);
      }
    }
  });

  it('keeps the root administrator authorized for every page and page operation', () => {
    const rootPermissions = new Set<string>(resolveAdminPermissions('super_admin'));
    for (const page of PAGE_PERMISSION_GROUPS.flatMap((group) => group.pages)) {
      expect(rootPermissions.has(page.view), page.view).toBe(true);
      if (page.manage) expect(rootPermissions.has(page.manage), page.manage).toBe(true);
      for (const action of page.actions ?? []) {
        expect(rootPermissions.has(action.key), action.key).toBe(true);
      }
    }
  });

  it('separates gateway technical retry from finance review and absorption', () => {
    const operator = new Set<string>(resolveAdminPermissions('operator'));
    const finance = new Set<string>(resolveAdminPermissions('finance'));
    const admin = new Set<string>(resolveAdminPermissions('admin'));

    expect(operator.has('admin.page.gateway_billing_events.retry')).toBe(true);
    expect(operator.has('admin.page.gateway_billing_events.review')).toBe(false);
    expect(operator.has('admin.page.gateway_billing_events.settle')).toBe(false);
    expect(operator.has('admin.page.gateway_billing_events.absorb')).toBe(false);

    expect(finance.has('admin.page.gateway_billing_events.retry')).toBe(false);
    expect(finance.has('admin.page.gateway_billing_events.review')).toBe(true);
    expect(finance.has('admin.page.gateway_billing_events.settle')).toBe(true);
    expect(finance.has('admin.page.gateway_billing_events.absorb')).toBe(true);

    expect(admin.has('admin.page.gateway_billing_events.retry')).toBe(true);
    expect(admin.has('admin.page.gateway_billing_events.review')).toBe(false);
    expect(admin.has('admin.page.gateway_billing_events.settle')).toBe(false);
    expect(admin.has('admin.page.gateway_billing_events.absorb')).toBe(false);

    const legacyManage = new Set<string>(
      expandAdminPermissions(['admin.page.gateway_billing_events.manage']),
    );
    expect(legacyManage.has('admin.page.gateway_billing_events.retry')).toBe(true);
    expect(legacyManage.has('admin.page.gateway_billing_events.view')).toBe(true);
    expect(legacyManage.has('admin.page.gateway_billing_events.review')).toBe(false);
    expect(legacyManage.has('admin.page.gateway_billing_events.settle')).toBe(false);
    expect(legacyManage.has('admin.page.gateway_billing_events.absorb')).toBe(false);

    for (const action of [
      'admin.page.gateway_billing_events.retry',
      'admin.page.gateway_billing_events.review',
      'admin.page.gateway_billing_events.settle',
      'admin.page.gateway_billing_events.absorb',
    ] as const) {
      const expanded = new Set<string>(expandAdminPermissions([action]));
      expect(expanded.has('admin.page.gateway_billing_events.view')).toBe(true);
    }
  });

  it('keeps historical platform-loss approval isolated to finance and root presets', () => {
    const finance = new Set<string>(resolveAdminPermissions('finance'));
    const root = new Set<string>(resolveAdminPermissions('super_admin'));
    const admin = new Set<string>(resolveAdminPermissions('admin'));
    const operator = new Set<string>(resolveAdminPermissions('operator'));
    const legacyGatewayManage = new Set<string>(
      expandAdminPermissions(['admin.page.gateway_billing_events.manage']),
    );

    for (const permission of [
      'admin.page.historical_platform_losses.view',
      'admin.page.historical_platform_losses.export',
      'admin.page.historical_platform_losses.prepare',
      'admin.page.historical_platform_losses.approve_post',
    ]) {
      expect(finance.has(permission), permission).toBe(true);
      expect(root.has(permission), permission).toBe(true);
      expect(admin.has(permission), permission).toBe(false);
      expect(operator.has(permission), permission).toBe(false);
      expect(legacyGatewayManage.has(permission), permission).toBe(false);
    }

    for (const action of [
      'admin.page.historical_platform_losses.export',
      'admin.page.historical_platform_losses.prepare',
      'admin.page.historical_platform_losses.approve_post',
    ] as const) {
      const expanded = new Set<string>(expandAdminPermissions([action]));
      expect(expanded.has('admin.page.historical_platform_losses.view')).toBe(true);
      expect(hasRoutePermission('/historical-platform-losses', [action])).toBe(true);
    }
  });

  it('returns the first accessible admin route, including deep-link-only tools', () => {
    expect(getDefaultAdminRoute(['admin.orders.view'])).toBe('/orders');
    expect(getDefaultAdminRoute(['admin.page.finance_reports.view'])).toBe('/finance-reports');
    expect(getDefaultAdminRoute(['admin.page.sessions.view'])).toBe('/sessions');
    expect(getDefaultAdminRoute(['admin.page.model_access.view'])).toBe('/model-access');
    expect(getDefaultAdminRoute([])).toBe('/403');
  });
  it('isolates assisted creation from manage, users and ordinary enterprise view grants', () => {
    const route = '/enterprise-accounts-v2/admin-create';
    expect(getRoutePermission(route)).toBe('admin.page.enterprise_accounts.review');
    expect(hasRoutePermission(route, ['admin.page.enterprise_accounts.review'])).toBe(true);
    expect(hasRoutePermission(route, ['admin.enterprise_accounts.review'])).toBe(true);
    for (const p of ['admin.page.enterprise_accounts.manage', 'admin.page.enterprise_accounts.view', 'admin.page.users.view']) {
      expect(hasRoutePermission(route, [p])).toBe(false);
    }
    // Existing permission expansion also grants the enterprise view atom; official entry is V2.
    expect(getDefaultAdminRoute(['admin.page.enterprise_accounts.review'])).toBe('/enterprise-accounts-v2');
    expect(getDefaultAdminRoute(['admin.page.dashboard.view', 'admin.page.enterprise_accounts.review'])).toBe('/');
  });
  it('keeps records and original results on review rather than legacy financial detail permission',()=>{
    for(const route of ['/enterprise-accounts-v2/admin-creations','/enterprise-accounts-v2/admin-creations/123e4567-e89b-42d3-a456-426614174000']){
      expect(getRoutePermission(route)).toBe('admin.page.enterprise_accounts.review');expect(hasRoutePermission(route,['admin.page.enterprise_accounts.review'])).toBe(true);expect(hasRoutePermission(route,['admin.page.enterprise_accounts.manage'])).toBe(false);
    }
  });
});
