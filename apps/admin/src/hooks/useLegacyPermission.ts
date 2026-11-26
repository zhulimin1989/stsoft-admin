import { expandAdminPermissions } from '@ruidong/shared';

/**
 * Legacy permission mapping.
 *
 * Backend still emits the old `admin.*` permission keys on `user.resolvedPermissions`.
 * The new IA components reference the new namespaced keys (e.g. `users.manage`,
 * `finance.orders.manage`). This module bridges the two so we don't have to ship
 * a backend change in lockstep with the frontend redesign.
 */

export const LEGACY_PERMISSION_MAP: Record<string, string> = {
  'admin.dashboard': 'dashboard.view',
  'admin.users.view': 'users.view',
  'admin.users.manage': 'users.manage',
  'admin.enterprise_accounts.review': 'users.enterprise.review',
  'admin.products.manage': 'products.manage',
  'admin.plans.view': 'products.plans.view',
  'admin.plans.manage': 'products.plans.manage',
  'admin.booster_packs.manage': 'products.plans.manage',
  'admin.campaigns.manage': 'products.plans.manage',
  'admin.discount_codes.manage': 'products.plans.manage',
  'admin.orders.view': 'finance.orders.view',
  'admin.orders.manage': 'finance.orders.manage',
  'admin.transactions.view': 'finance.usage.read',
  'admin.revenue.view': 'finance.revenue.read',
  'admin.payment_config.manage': 'finance.payment.manage',
  'admin.system.manage': 'system.config.manage',
  'admin.channels.view': 'ops.channels.view',
  'admin.channels.manage': 'ops.channels.manage',
  'admin.model_pricing.manage': 'ops.pricing.manage',
  'admin.sessions.read': 'audit.monitoring.read',
  'admin.monitoring.view': 'audit.monitoring.read',
  'admin.audit.view': 'audit.logs.read',
  'admin.announcements.manage': 'audit.announcements.manage',
  'admin.roles.manage': 'system.team.manage',
  'admin.members.manage': 'system.team.manage',
  // v2 新增权限映射
  'admin.user_segments.manage': 'users.segments.manage',
  'admin.tickets.manage': 'users.tickets.manage',
  'admin.risk.users.manage': 'users.risk.manage',
  'admin.quota_rules.manage': 'products.subscriptions.quota.manage',
  'admin.subscriptions.manage': 'products.subscriptions.lifecycle.manage',
  'admin.recharge_tiers.manage': 'products.payg.tiers.manage',
  'admin.credit_policy.manage': 'products.payg.policy.manage',
  'admin.grant_rules.manage': 'marketing.grants.manage',
  'admin.referrals.manage': 'marketing.referrals.manage',
  'admin.alerts.manage': 'audit.alerts.manage',
  'admin.funnel.read': 'audit.funnel.read',
  'admin.risk.rules.manage': 'audit.risk.manage',
  'admin.api_keys.manage': 'ops.apikeys.manage',
};

/** Returns the new-style permission key for a legacy key, or the input unchanged. */
export function mapPermission(legacyKey: string): string {
  return LEGACY_PERMISSION_MAP[legacyKey] ?? legacyKey;
}

/**
 * Given a list of owned permission keys (in either legacy or new format),
 * return a deduped array containing both the original keys and their mapped
 * new-style equivalents (where applicable).
 */
export function expandPermissions(owned: string[]): string[] {
  const expanded = expandAdminPermissions(owned);
  const set = new Set<string>(expanded);
  for (const key of expanded) {
    const mapped = LEGACY_PERMISSION_MAP[key];
    if (mapped) set.add(mapped);
  }
  return [...set];
}
