import { describe, it, expect } from 'vitest';
import { mapPermission, expandPermissions } from '../useLegacyPermission';

describe('mapPermission', () => {
  it('maps old to new key', () => {
    expect(mapPermission('admin.users.manage')).toBe('users.manage');
    expect(mapPermission('admin.orders.manage')).toBe('finance.orders.manage');
    expect(mapPermission('admin.booster_packs.manage')).toBe('products.plans.manage');
  });

  it('returns input if no mapping', () => {
    expect(mapPermission('unknown.key')).toBe('unknown.key');
  });
});

describe('expandPermissions', () => {
  it('returns both old and new keys for owned old keys', () => {
    const result = expandPermissions(['admin.users.manage']);
    expect(result).toContain('admin.users.manage');
    expect(result).toContain('users.manage');
  });

  it('handles multiple', () => {
    const result = expandPermissions(['admin.roles.manage', 'admin.members.manage']);
    expect(result).toContain('system.team.manage');
  });

  it('expands legacy bundles to page and action permissions', () => {
    const result = expandPermissions(['admin.revenue.view']);
    expect(result).toContain('admin.page.finance_reports.view');
    expect(result).toContain('admin.page.finance_reports.export');
    expect(result).toContain('admin.page.finance_export_jobs.download');
  });

  it('keeps a leaf page grant isolated from sibling pages', () => {
    const result = expandPermissions(['admin.page.subscription_plans.view']);
    expect(result).toContain('admin.catalog.products.view');
    expect(result).not.toContain('admin.page.subscription_booster_packs.view');
    expect(result).not.toContain('admin.plans.view');
  });

  it('turns page operations into the same page view without revealing sibling pages', () => {
    const result = expandPermissions(['admin.page.models.channel_manage']);
    expect(result).toContain('admin.page.models.view');
    expect(result).toContain('admin.data.channels.manage');
    expect(result).not.toContain('admin.page.channels.view');
  });

  it('keeps legacy channel administrators able to manage model-channel mappings', () => {
    const result = expandPermissions(['admin.channels.manage']);
    expect(result).toContain('admin.page.models.channel_manage');
  });

  it('adds hidden catalog capabilities needed to render one page', () => {
    const planResult = expandPermissions(['admin.page.subscription_plans.view']);
    expect(planResult).toContain('admin.catalog.products.view');
    expect(planResult).toContain('admin.catalog.plans.view');
    expect(planResult).toContain('admin.catalog.models.view');

    const bundleResult = expandPermissions(['admin.page.bundles.view']);
    expect(bundleResult).toContain('admin.catalog.booster_packs.view');
    expect(bundleResult).not.toContain('admin.page.subscription_booster_packs.view');
  });
});
