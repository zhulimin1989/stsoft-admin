import { expandPermissions } from '../hooks/useLegacyPermission';

export const ROUTE_PERMISSIONS: Record<string, string> = {
  '/': 'admin.page.dashboard.view',
  '/users': 'admin.page.users.view',
  '/users/:id': 'admin.page.users.view',
  '/team': 'admin.page.roles.view',
  '/members': 'admin.page.members.view',
  '/roles': 'admin.page.roles.view',
  '/products': 'admin.page.products.view',
  '/plans': 'admin.page.subscription_plans.view',
  '/plans/:id': 'admin.page.subscription_plans.view',
  '/plans/new': 'admin.page.subscription_plans.manage',
  '/plan-templates': 'admin.page.subscription_plans.view',
  '/plan-templates/:id': 'admin.page.subscription_plans.view',
  '/plan-templates/new': 'admin.page.subscription_plans.manage',
  '/booster-packs': 'admin.page.subscription_booster_packs.view',
  '/bundles': 'admin.page.bundles.view',
  '/campaigns': 'admin.page.campaigns.view',
  '/discount-codes': 'admin.page.discount_codes.view',
  '/api-keys': 'admin.page.api_keys.view',
  '/payg-accounts': 'admin.page.payg_accounts.view',
  '/channels': 'admin.page.channels.view',
  '/delivery-settings': 'admin.page.delivery_settings.view',
  '/model-access': 'admin.page.model_access.view',
  '/model-pricing': 'admin.page.models.view',
  '/orders': 'admin.page.orders.view',
  '/invoices': 'admin.page.invoices.view',
  '/usage': 'admin.page.usage.view',
  '/transactions': 'admin.page.usage.view',
  '/gateway-billing-events': 'admin.page.gateway_billing_events.view',
  '/revenue': 'admin.page.revenue.view',
  '/finance-overview': 'admin.page.finance_overview.view',
  '/finance-reports': 'admin.page.finance_reports.view',
  '/finance-reconciliation': 'admin.page.finance_reconciliation.view',
  '/finance-export-jobs': 'admin.page.finance_export_jobs.view',
  '/historical-platform-losses': 'admin.page.historical_platform_losses.view',
  '/enterprise-accounts': 'admin.page.enterprise_accounts.view',
  '/enterprise-accounts-v2': 'admin.page.enterprise_accounts.view',
  '/enterprise-accounts-v2/admin-create': 'admin.page.enterprise_accounts.review',
  '/enterprise-accounts-v2/admin-creations': 'admin.page.enterprise_accounts.review',
  '/enterprise-accounts-v2/admin-creations/:requestId': 'admin.page.enterprise_accounts.review',
  '/enterprise-accounts-v2/:id': 'admin.page.enterprise_accounts.view',
  '/payment-config': 'admin.page.payment_config.view',
  '/sessions': 'admin.page.sessions.view',
  '/monitoring': 'admin.page.monitoring.view',
  '/publisher-sync-jobs': 'admin.page.publisher_sync_jobs.view',
  '/agent-observability': 'admin.page.agent_observability.view',
  '/audit-logs': 'admin.page.audit_logs.view',
  '/announcements': 'admin.page.announcements.view',
  '/feature-flags': 'admin.page.feature_flags.view',
  '/system-prompts': 'admin.page.system_prompts.view',
  '/system-config': 'admin.page.system_config.view',
  '/user-segments': 'admin.page.user_segments.view',
  '/user-segments/:id': 'admin.page.user_segments.view',
  '/tickets': 'admin.page.tickets.view',
  '/tickets/:id': 'admin.page.tickets.view',
  '/risk-users': 'admin.page.risk_users.view',
  '/quota-rules': 'admin.page.coding_quota_templates.view',
  '/subscriptions': 'admin.page.subscription_accounts.view',
  '/coding-plan/design': 'admin.page.coding_self_managed_plans.view',
  '/coding-plan/self-managed-plans': 'admin.page.coding_self_managed_plans.view',
  '/coding-plan/third-party-plans': 'admin.page.coding_third_party_plans.view',
  '/coding-plan/resale-config': 'admin.page.coding_resale_config.view',
  '/coding-plan/resale-report': 'admin.page.coding_resale_report.view',
  '/coding-plan/quota-templates': 'admin.page.coding_quota_templates.view',
  '/coding-plan/plans/new': 'admin.page.coding_self_managed_plans.manage',
  '/coding-plan/plans/:id': 'admin.page.coding_self_managed_plans.view',
  '/coding-plan': 'admin.page.coding_third_party_plans.view',
  '/payg-pricing': 'admin.page.payg_pricing.view',
  '/usage-pricing-policies': 'admin.page.usage_pricing_policies.view',
  '/recharge-tiers': 'admin.page.recharge_tiers.view',
  '/credit-policy': 'admin.page.credit_policy.view',
  '/grant-rules': 'admin.page.grant_rules.view',
  '/grant-rules/new': 'admin.page.grant_rules.manage',
  '/grant-rules/:id': 'admin.page.grant_rules.view',
  '/referrals': 'admin.page.referrals.view',
  '/alerts': 'admin.page.alerts.view',
  '/funnel': 'admin.page.funnel.view',
  '/risk-rules': 'admin.page.risk_rules.view',
  '/models': 'admin.page.models.view',
  '/models/new': 'admin.page.models.manage',
  '/models/:id': 'admin.page.models.view',
  '/provider-cost-policies': 'admin.page.provider_cost_policies.view',
};

export const ADMIN_ROUTE_ORDER = [
  '/',
  '/users', '/enterprise-accounts-v2', '/enterprise-accounts', '/enterprise-accounts-v2/admin-create', '/user-segments', '/tickets', '/risk-users',
  '/products', '/plans', '/booster-packs', '/subscriptions',
  '/coding-plan/self-managed-plans', '/coding-plan/quota-templates', '/coding-plan/third-party-plans', '/coding-plan/resale-config', '/coding-plan/design', '/coding-plan/plans/new', '/coding-plan',
  '/payg-accounts', '/api-keys', '/usage', '/revenue', '/sessions', '/model-access',
  '/payg-pricing', '/usage-pricing-policies', '/recharge-tiers', '/credit-policy',
  '/bundles', '/campaigns', '/discount-codes', '/grant-rules', '/referrals',
  '/models', '/provider-cost-policies', '/channels', '/delivery-settings',
  '/finance-overview', '/orders', '/invoices', '/coding-plan/resale-report', '/finance-reports', '/finance-reconciliation', '/finance-export-jobs', '/historical-platform-losses',
  '/monitoring', '/gateway-billing-events', '/publisher-sync-jobs', '/agent-observability', '/alerts', '/funnel', '/risk-rules', '/audit-logs', '/announcements',
  '/team', '/members', '/feature-flags', '/system-prompts', '/payment-config', '/system-config',
] as const;

export function getRoutePermission(route: string): string | undefined {
  const normalized = normalizePath(route);
  const exact = ROUTE_PERMISSIONS[normalized];
  if (exact) return exact;

  const matchedPattern = Object.keys(ROUTE_PERMISSIONS)
    .filter((pattern) => routePatternMatches(pattern, normalized))
    .sort((a, b) => b.length - a.length)[0];

  return matchedPattern ? ROUTE_PERMISSIONS[matchedPattern] : undefined;
}

export function hasRoutePermission(route: string, resolvedPermissions: string[] = []): boolean {
  const required = getRoutePermission(route);
  if (!required) return true;
  return expandPermissions(resolvedPermissions).includes(required);
}

export function getDefaultAdminRoute(resolvedPermissions: string[] = []): string {
  const match = ADMIN_ROUTE_ORDER.find((route) => hasRoutePermission(route, resolvedPermissions));
  return match ?? '/403';
}

export interface PagePermissionDefinition {
  key: string;
  label: string;
  view: string;
  manage?: string;
  actions?: Array<{ key: string; label: string }>;
}

export interface PagePermissionGroup {
  key: string;
  label: string;
  pages: PagePermissionDefinition[];
}

function definePage(
  key: string,
  label: string,
  options?: {
    manage?: boolean;
    actions?: Array<{ action: string; label: string }>;
  },
): PagePermissionDefinition {
  return {
    key,
    label,
    view: `admin.page.${key}.view`,
    ...(options?.manage ? { manage: `admin.page.${key}.manage` } : {}),
    ...(options?.actions?.length
      ? {
          actions: options.actions.map((action) => ({
            key: `admin.page.${key}.${action.action}`,
            label: action.label,
          })),
        }
      : {}),
  };
}

/** Every real Admin page is assignable here. Detail routes inherit their parent page. */
export const PAGE_PERMISSION_GROUPS: PagePermissionGroup[] = [
  {
    key: 'overview',
    label: '总览',
    pages: [
      definePage('dashboard', '运营总览'),
      definePage('funnel', '业务漏斗'),
    ],
  },
  {
    key: 'users',
    label: '用户运营',
    pages: [
      definePage('users', '用户管理', { manage: true }),
      definePage('enterprise_accounts', '企业账户', {
        manage: true,
        actions: [
          { action: 'review', label: '认证审核' },
          { action: 'detach', label: '解绑租户' },
        ],
      }),
      definePage('user_segments', '用户分群', { manage: true }),
      definePage('tickets', '工单中心', { manage: true }),
    ],
  },
  {
    key: 'risk',
    label: '风控',
    pages: [
      definePage('risk_users', '风险用户', { manage: true }),
      definePage('risk_rules', '风控规则', { manage: true }),
    ],
  },
  {
    key: 'products',
    label: '产品管理',
    pages: [definePage('products', '产品列表', { manage: true })],
  },
  {
    key: 'subscription',
    label: '订阅运营',
    pages: [
      definePage('subscription_plans', '套餐管理', { manage: true }),
      definePage('subscription_booster_packs', '加油包', { manage: true }),
      definePage('subscription_accounts', '订阅账号', { manage: true }),
    ],
  },
  {
    key: 'payg',
    label: '按量运营',
    pages: [
      definePage('payg_pricing', '按量定价', { manage: true }),
      definePage('usage_pricing_policies', '用量折扣策略', { manage: true }),
      definePage('recharge_tiers', '充值面额', { manage: true }),
      definePage('credit_policy', '信用额度', { manage: true }),
      definePage('payg_accounts', '按量账号', { manage: true }),
    ],
  },
  {
    key: 'coding_plan',
    label: 'CodingPlan',
    pages: [
      definePage('coding_self_managed_plans', '自营套餐', { manage: true }),
      definePage('coding_quota_templates', '配额模板', { manage: true }),
      definePage('coding_third_party_plans', '三方套餐', { manage: true }),
      definePage('coding_resale_config', '转售配置', { manage: true }),
      definePage('coding_resale_report', '转售报表', { manage: true }),
    ],
  },
  {
    key: 'growth',
    label: '营销',
    pages: [
      definePage('bundles', '组合套餐', { manage: true }),
      definePage('campaigns', '限时活动', { manage: true }),
      definePage('discount_codes', '促销码', { manage: true }),
      definePage('grant_rules', '积分发放规则', { manage: true }),
      definePage('referrals', '邀请裂变', { manage: true }),
      definePage('announcements', '公告通知', { manage: true }),
    ],
  },
  {
    key: 'supply',
    label: '供给与渠道',
    pages: [
      definePage('models', '模型库', {
        manage: true,
        actions: [{ action: 'channel_manage', label: '渠道映射' }],
      }),
      definePage('provider_cost_policies', '供应商成本', { manage: true }),
      definePage('channels', '供应商管理', { manage: true }),
      definePage('delivery_settings', '投放设置', { manage: true }),
      definePage('publisher_sync_jobs', 'Publisher 同步', { manage: true }),
    ],
  },
  {
    key: 'finance',
    label: '财务中心',
    pages: [
      definePage('finance_overview', '财务总览'),
      definePage('orders', '订单管理', { manage: true }),
      definePage('invoices', '发票管理', { manage: true }),
      definePage('finance_reports', '财务报表', {
        actions: [{ action: 'export', label: '导出' }],
      }),
      definePage('finance_reconciliation', '财务对账', {
        manage: true,
        actions: [{ action: 'export', label: '导出' }],
      }),
      definePage('finance_export_jobs', '导出任务', {
        actions: [{ action: 'download', label: '下载' }],
      }),
      definePage('historical_platform_losses', '历史平台损失', {
        actions: [
          { action: 'export', label: '导出' },
          { action: 'prepare', label: '准备批次' },
          { action: 'approve_post', label: '审批并入账' },
        ],
      }),
    ],
  },
  {
    key: 'observability',
    label: '监控告警',
    pages: [
      definePage('monitoring', '实时监控', { manage: true }),
      definePage('gateway_billing_events', 'Gateway 入账', {
        actions: [
          { action: 'retry', label: '技术重试' },
          { action: 'review', label: '证据复核' },
          { action: 'settle', label: '权威证据结算' },
          { action: 'absorb', label: '平台吸收' },
        ],
      }),
      definePage('alerts', '告警中心', { manage: true }),
      definePage('agent_observability', 'Agent 观测'),
    ],
  },
  {
    key: 'system',
    label: '系统',
    pages: [
      definePage('roles', '角色权限', { manage: true }),
      definePage('members', '后台账号', { manage: true }),
      definePage('audit_logs', '审计日志'),
      definePage('feature_flags', '功能开关', { manage: true }),
      definePage('system_prompts', '系统提示词', { manage: true }),
      definePage('payment_config', '支付配置', { manage: true }),
      definePage('system_config', '系统设置', { manage: true }),
    ],
  },
  {
    key: 'direct_tools',
    label: '直达工具',
    pages: [
      definePage('api_keys', 'API Key 管理', { manage: true }),
      definePage('usage', '额度流水'),
      definePage('revenue', '收入分析'),
      definePage('sessions', '会话记录'),
      definePage('model_access', '模型访问矩阵', { manage: true }),
    ],
  },
];

const PAGE_PERMISSION_LABELS = Object.fromEntries(
  PAGE_PERMISSION_GROUPS.flatMap((group) =>
    group.pages.flatMap((page) => [
      [page.view, `查看${page.label}`],
      ...(page.manage ? [[page.manage, `管理${page.label}`]] : []),
      ...(page.actions ?? []).map((action) => [
        action.key,
        `${action.label} · ${page.label}`,
      ]),
    ]),
  ),
);

export const PERMISSION_LABELS: Record<string, string> = {
  'admin.dashboard': 'Dashboard',
  'admin.users.view': '查看用户',
  'admin.users.manage': '管理用户',
  'admin.enterprise_accounts.review': '企业认证审核',
  'admin.tickets.view': '查看工单',
  'admin.tickets.manage': '管理工单',
  'admin.orders.view': '查看订单',
  'admin.orders.manage': '管理订单',
  'admin.transactions.view': '查看额度流水',
  'admin.revenue.view': '收入分析',
  'admin.plans.view': '查看套餐',
  'admin.plans.manage': '管理套餐',
  'admin.channels.view': '查看渠道',
  'admin.channels.manage': '管理渠道',
  'admin.monitoring.view': '系统监控',
  'admin.announcements.manage': '公告管理',
  'admin.audit.view': '审计日志',
  'admin.audit.manage': '风控处置',
  'admin.system.manage': '系统配置',
  'admin.members.manage': '后台账号管理',
  ...PAGE_PERMISSION_LABELS,
};

function normalizePath(route: string): string {
  if (!route || route === '/') return '/';
  const [path] = route.split('?');
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

function routePatternMatches(pattern: string, route: string): boolean {
  const normalizedPattern = normalizePath(pattern);
  const patternParts = normalizedPattern.split('/').filter(Boolean);
  const routeParts = normalizePath(route).split('/').filter(Boolean);

  if (patternParts.length !== routeParts.length) return false;

  return patternParts.every((part, index) => {
    return part.startsWith(':') || part === routeParts[index];
  });
}
