import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useNavigate, Navigate, useLocation, Link } from 'react-router-dom';
import { Dropdown, Spin } from 'antd';
import {
  DashboardOutlined, FunnelPlotOutlined, TeamOutlined, PieChartOutlined, CustomerServiceOutlined,
  UserDeleteOutlined, UsergroupAddOutlined, SafetyOutlined, AppstoreOutlined, CrownOutlined, ThunderboltOutlined,
  ControlOutlined, RetweetOutlined, TagOutlined, PercentageOutlined, PayCircleOutlined,
  CreditCardOutlined, DollarOutlined, EditOutlined, KeyOutlined,
  GroupOutlined, FieldTimeOutlined, BarcodeOutlined, GiftOutlined, ShareAltOutlined, SoundOutlined,
  DeploymentUnitOutlined, ApartmentOutlined, CloudSyncOutlined, ProfileOutlined, InboxOutlined,
  BarChartOutlined, WalletOutlined, LineChartOutlined, BellOutlined, EyeOutlined, LockOutlined,
  UserOutlined, FileSearchOutlined, ExperimentOutlined, MessageOutlined, SettingOutlined,
  SearchOutlined, LogoutOutlined, DownOutlined, ApiOutlined, DatabaseOutlined, DownloadOutlined,
  FileTextOutlined, BankOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../stores/auth-store';
import { getDefaultAdminRoute, getRoutePermission, hasRoutePermission } from '../config/permissions';
import { PlatformConfigProvider } from '../contexts/PlatformConfigContext';
import { warnNonCritical } from '../utils/logging';
import { reloadForFreshChunks } from '../utils/chunkReload';
import { usePermission } from '../hooks/usePermission';
import { useCreationCapabilities } from '../pages/EnterpriseAdminCreation/useCreationCapabilities';
import './AdminLayout.css';

interface MenuItem {
  key: string;
  label: string;
  icon: ReactNode;
}

interface MenuGroup {
  key: string;
  // null = 顶部固定区(无分组标题,不可折叠)
  label: string | null;
  items: MenuItem[];
}

// Note: routes here must match those declared in app.tsx and config/permissions.ts.
// Some legacy routes (/api-keys, /usage, /revenue, /sessions, /model-access) remain
// reachable via deep-link but are intentionally not surfaced in the nav.
//
// IA 原则(2026-06 重组):
//   纵向 = 业务模式:产品管理(上游,创建三类业务的产品)→ 订阅运营 / 按量运营 / CodingPlan。
//          各业务的「账号」是该业务模式下的用户,跟随业务,统一放组内末位。
//   横向 = 跨业务职能:用户运营(全局注册用户)、风控、营销、供给、财务、监控、系统。
const MENU_GROUPS: MenuGroup[] = [
  { key: 'pinned', label: null, items: [
    { key: '/', label: '运营总览', icon: <DashboardOutlined /> },
    { key: '/funnel', label: '业务漏斗', icon: <FunnelPlotOutlined /> },
  ]},
  { key: 'users', label: '用户运营', items: [
    { key: '/users', label: '用户管理', icon: <TeamOutlined /> },
    { key: '/enterprise-accounts-v2', label: '企业账户', icon: <BankOutlined /> },
    { key: '/enterprise-accounts-v2/admin-create', label: '代客创建企业账户', icon: <UsergroupAddOutlined /> },
    { key: '/enterprise-accounts-v2/admin-creations', label: '代办记录', icon: <FileTextOutlined /> },
    { key: '/user-segments', label: '用户分群', icon: <PieChartOutlined /> },
    { key: '/tickets', label: '工单中心', icon: <CustomerServiceOutlined /> },
  ]},
  { key: 'risk', label: '风控', items: [
    { key: '/risk-users', label: '风险用户', icon: <UserDeleteOutlined /> },
    { key: '/risk-rules', label: '风控规则', icon: <SafetyOutlined /> },
  ]},
  // 产品管理是订阅/按量/CodingPlan 三种业务模式的上游:三类业务的产品都在这里创建
  { key: 'products', label: '产品管理', items: [
    { key: '/products', label: '产品列表', icon: <AppstoreOutlined /> },
  ]},
  { key: 'subscription', label: '订阅运营', items: [
    { key: '/plans', label: '套餐管理', icon: <CrownOutlined /> },
    { key: '/booster-packs', label: '加油包', icon: <ThunderboltOutlined /> },
    { key: '/subscriptions', label: '订阅账号', icon: <RetweetOutlined /> },
  ]},
  { key: 'payg', label: '按量运营', items: [
    { key: '/payg-pricing', label: '按量定价', icon: <TagOutlined /> },
    { key: '/usage-pricing-policies', label: '用量折扣策略', icon: <PercentageOutlined /> },
    { key: '/recharge-tiers', label: '充值面额', icon: <PayCircleOutlined /> },
    { key: '/credit-policy', label: '信用额度', icon: <CreditCardOutlined /> },
    { key: '/payg-accounts', label: '按量账号', icon: <DollarOutlined /> },
  ]},
  { key: 'coding-plan', label: 'CodingPlan', items: [
    { key: '/coding-plan/self-managed-plans', label: '自营套餐', icon: <EditOutlined /> },
    { key: '/coding-plan/quota-templates', label: '配额模板', icon: <DatabaseOutlined /> },
    { key: '/coding-plan/third-party-plans', label: '三方套餐', icon: <ControlOutlined /> },
    { key: '/coding-plan/resale-config', label: '转售配置', icon: <KeyOutlined /> },
    { key: '/coding-plan/resale-report', label: '转售报表', icon: <ProfileOutlined /> },
  ]},
  { key: 'growth', label: '营销', items: [
    { key: '/bundles', label: '组合套餐', icon: <GroupOutlined /> },
    { key: '/campaigns', label: '限时活动', icon: <FieldTimeOutlined /> },
    { key: '/discount-codes', label: '促销码', icon: <BarcodeOutlined /> },
    { key: '/grant-rules', label: '积分发放规则', icon: <GiftOutlined /> },
    { key: '/referrals', label: '邀请裂变', icon: <ShareAltOutlined /> },
    { key: '/announcements', label: '公告通知', icon: <SoundOutlined /> },
  ]},
  { key: 'supply', label: '供给与渠道', items: [
    { key: '/models', label: '模型库', icon: <DeploymentUnitOutlined /> },
    { key: '/provider-cost-policies', label: '供应商成本', icon: <DollarOutlined /> },
    { key: '/channels', label: '供应商管理', icon: <ApartmentOutlined /> },
    { key: '/delivery-settings', label: '投放设置', icon: <ControlOutlined /> },
    { key: '/publisher-sync-jobs', label: 'Publisher 同步', icon: <CloudSyncOutlined /> },
  ]},
  { key: 'finance', label: '财务中心', items: [
    { key: '/finance-overview', label: '财务总览', icon: <PieChartOutlined /> },
    { key: '/orders', label: '订单管理', icon: <ProfileOutlined /> },
    { key: '/invoices', label: '发票管理', icon: <FileTextOutlined /> },
    { key: '/finance-reports', label: '财务报表', icon: <BarChartOutlined /> },
    { key: '/finance-reconciliation', label: '财务对账', icon: <FileSearchOutlined /> },
    { key: '/finance-export-jobs', label: '导出任务', icon: <DownloadOutlined /> },
    { key: '/historical-platform-losses', label: '历史平台损失', icon: <WarningOutlined /> },
  ]},
  { key: 'observability', label: '监控告警', items: [
    { key: '/monitoring', label: '实时监控', icon: <LineChartOutlined /> },
    { key: '/gateway-billing-events', label: 'Gateway 入账', icon: <InboxOutlined /> },
    { key: '/alerts', label: '告警中心', icon: <BellOutlined /> },
    { key: '/agent-observability', label: 'Agent 观测', icon: <EyeOutlined /> },
  ]},
  { key: 'system', label: '系统', items: [
    { key: '/team', label: '角色权限', icon: <LockOutlined /> },
    { key: '/members', label: '后台账号', icon: <UserOutlined /> },
    { key: '/audit-logs', label: '审计日志', icon: <FileSearchOutlined /> },
    { key: '/feature-flags', label: '功能开关', icon: <ExperimentOutlined /> },
    { key: '/system-prompts', label: '系统提示词', icon: <MessageOutlined /> },
    { key: '/payment-config', label: '支付配置', icon: <WalletOutlined /> },
    { key: '/system-config', label: '系统设置', icon: <SettingOutlined /> },
  ]},
];

const ROUTE_TO_TITLE: Record<string, { group: string; page: string }> = {};
for (const group of MENU_GROUPS) {
  for (const item of group.items) {
    ROUTE_TO_TITLE[item.key] = { group: group.label ?? '总览', page: item.label };
  }
}

const ROUTE_PRELOADERS: Record<string, () => Promise<unknown>> = {
  '/': () => import('../pages/Dashboard'),
  '/users': () => import('../pages/Users'),
  '/user-segments': () => import('../pages/UserSegments'),
  '/tickets': () => import('../pages/Tickets'),
  '/risk-users': () => import('../pages/RiskUsers'),
  '/products': () => import('../pages/Products'),
  '/plans': () => import('../pages/PlanTemplates'),
  '/booster-packs': () => import('../pages/BoosterPacks'),
  '/quota-rules': () => import('../pages/QuotaTemplates'),
  '/coding-plan/quota-templates': () => import('../pages/QuotaTemplates'),
  '/subscriptions': () => import('../pages/Subscriptions'),
  '/coding-plan/design': () => import('../pages/CodingPlanDesign'),
  '/coding-plan/self-managed-plans': () => import('../pages/CodingPlanDesign'),
  '/coding-plan/third-party-plans': () => import('../pages/CodingPlanResale'),
  '/coding-plan/resale-config': () => import('../pages/CodingPlanResale'),
  '/coding-plan/resale-report': () => import('../pages/CodingPlanResale'),
  '/coding-plan/plans/new': () => import('../pages/CodingPlanPlanDetail'),
  '/payg-accounts': () => import('../pages/PaygAccounts'),
  '/payg-pricing': () => import('../pages/PaygPricing'),
  '/usage-pricing-policies': () => import('../pages/UsagePricingPolicies'),
  '/recharge-tiers': () => import('../pages/RechargeTiers'),
  '/credit-policy': () => import('../pages/CreditPolicy'),
  '/bundles': () => import('../pages/Bundles'),
  '/campaigns': () => import('../pages/Campaigns'),
  '/discount-codes': () => import('../pages/DiscountCodes'),
  '/grant-rules': () => import('../pages/GrantRules'),
  '/referrals': () => import('../pages/Referrals'),
  '/models': () => import('../pages/Models'),
  '/provider-cost-policies': () => import('../pages/ProviderCostPolicies'),
  '/channels': () => import('../pages/Channels'),
  '/delivery-settings': () => import('../pages/DeliverySettings'),
  '/orders': () => import('../pages/Orders'),
  '/invoices': () => import('../pages/Invoices'),
  '/enterprise-accounts': () => import('../pages/EnterpriseAccounts'),
  '/enterprise-accounts-v2': () => import('../pages/EnterpriseAccountsV2'),
  '/enterprise-accounts-v2/admin-create': () => import('../pages/EnterpriseAdminCreation'),
  '/enterprise-accounts-v2/admin-creations': () => import('../pages/EnterpriseAdminRecords'),
  '/gateway-billing-events': () => import('../pages/GatewayBillingEvents'),
  '/finance-overview': () => import('../pages/FinanceOverview'),
  '/finance-reports': () => import('../pages/FinanceReports'),
  '/finance-reconciliation': () => import('../pages/FinanceReconciliation'),
  '/finance-export-jobs': () => import('../pages/FinanceExportJobs'),
  '/historical-platform-losses': () => import('../pages/HistoricalPlatformLosses'),
  '/payment-config': () => import('../pages/PaymentConfig'),
  '/monitoring': () => import('../pages/Monitoring'),
  '/publisher-sync-jobs': () => import('../pages/PublisherSyncJobs'),
  '/agent-observability': () => import('../pages/AgentObservability'),
  '/alerts': () => import('../pages/Alerts'),
  '/funnel': () => import('../pages/Funnel'),
  '/risk-rules': () => import('../pages/RiskRules'),
  '/audit-logs': () => import('../pages/AuditLogs'),
  '/announcements': () => import('../pages/Announcements'),
  '/team': () => import('../pages/Roles'),
  '/members': () => import('../pages/Members'),
  '/feature-flags': () => import('../pages/FeatureFlags'),
  '/system-prompts': () => import('../pages/SystemPrompts'),
  '/system-config': () => import('../pages/SystemConfig'),
};

const preloadedRoutes = new Set<string>();

function preloadRoute(path: string) {
  const loader = ROUTE_PRELOADERS[path];
  if (!loader || preloadedRoutes.has(path)) return;
  preloadedRoutes.add(path);
  void loader().catch((error: unknown) => {
    if (reloadForFreshChunks(error)) return;
    preloadedRoutes.delete(path);
    warnNonCritical(`Admin route preload path=${path}`, error);
  });
}

const COLLAPSED_STORAGE_KEY = 'admin.nav.collapsed';

function loadCollapsedGroups(): string[] {
  try {
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export default function AdminLayout() {
  const { user, loading, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(loadCollapsedGroups);
  const canCreate = usePermission('admin.page.enterprise_accounts.review');
  const { capabilities } = useCreationCapabilities(canCreate);

  const visibleGroups = useMemo(() => {
    const perms = user?.resolvedPermissions ?? [];
    return MENU_GROUPS
      .map((g) => ({
        ...g,
        items: g.items.filter((it) => hasRoutePermission(it.key, perms) && (it.key !== '/enterprise-accounts-v2/admin-create' || capabilities?.enabled)),
      }))
      .filter((g) => g.items.length > 0);
  }, [user?.resolvedPermissions, capabilities]);

  // 搜索时按组过滤;非搜索时原样
  const shownGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return visibleGroups;
    return visibleGroups
      .map((g) => ({ ...g, items: g.items.filter((it) => it.label.toLowerCase().includes(q)) }))
      .filter((g) => g.items.length > 0);
  }, [visibleGroups, query]);

  // 路由跳进被折叠的组时自动展开该组
  useEffect(() => {
    const activeGroup = MENU_GROUPS.find((g) => g.items.some((it) => isMenuItemActive(location.pathname, it.key)));
    if (activeGroup && collapsedGroups.includes(activeGroup.key)) {
      persistCollapsed(collapsedGroups.filter((k) => k !== activeGroup.key));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // ⌘K / Ctrl+K 聚焦菜单搜索
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function persistCollapsed(next: string[]) {
    setCollapsedGroups(next);
    try {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // localStorage 不可用(隐私模式等)时静默降级为仅本次会话生效
    }
  }

  function toggleGroup(key: string) {
    persistCollapsed(
      collapsedGroups.includes(key)
        ? collapsedGroups.filter((k) => k !== key)
        : [...collapsedGroups, key],
    );
  }

  if (loading) {
    return <div className="rt-spin-center"><Spin size="large" /></div>;
  }
  if (!user) return <Navigate to="/login" replace />;

  if (location.pathname === '/') {
    const def = getDefaultAdminRoute(user.resolvedPermissions);
    if (def === '/403') return <Navigate to="/403" replace />;
    if (def !== '/') return <Navigate to={def} replace />;
  }
  if (getRoutePermission(location.pathname) && !hasRoutePermission(location.pathname, user.resolvedPermissions)) {
    return <Navigate to="/403" replace />;
  }

  const currentCrumbs = getCurrentRouteCrumbs(location.pathname);
  const searching = query.trim().length > 0;

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const renderItem = (it: MenuItem) => (
    <Link
      key={it.key}
      to={it.key}
      onFocus={() => preloadRoute(it.key)}
      onMouseEnter={() => preloadRoute(it.key)}
      className={`rt-menu-item ${isMenuItemActive(location.pathname, it.key) ? 'rt-menu-item-active' : ''}`}
    >
      <span className="rt-menu-item-icon">{it.icon}</span>
      <span className="rt-menu-item-label">{it.label}</span>
    </Link>
  );

  return (
    <div className="rt-shell">
      <aside className="rt-sider">
        <div className="rt-sider-top">
          <div className="rt-brand">
            <span className="rt-brand-mark"><ApiOutlined /></span>
            <span className="rt-brand-text">睿动 Admin</span>
          </div>
          <div className="rt-nav-search">
            <SearchOutlined className="rt-nav-search-icon" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索菜单"
              aria-label="搜索菜单"
            />
            <kbd className="rt-kbd">⌘K</kbd>
          </div>
        </div>
        <nav className="rt-menu">
          {shownGroups.map((g) => {
            if (g.label === null) {
              return <div key={g.key} className="rt-menu-pinned">{g.items.map(renderItem)}</div>;
            }
            const collapsed = !searching && collapsedGroups.includes(g.key);
            return (
              <div key={g.key} className={`rt-menu-group ${collapsed ? 'rt-menu-group-collapsed' : ''}`}>
                <button type="button" className="rt-menu-glabel" onClick={() => toggleGroup(g.key)}>
                  <span>{g.label}</span>
                  <DownOutlined className="rt-menu-gcaret" />
                </button>
                <div className="rt-menu-gitems"><div>{g.items.map(renderItem)}</div></div>
              </div>
            );
          })}
          {searching && shownGroups.length === 0 && (
            <div className="rt-menu-empty">没有匹配「{query.trim()}」的菜单</div>
          )}
        </nav>
        <div className="rt-sider-foot">
          <Dropdown
            menu={{
              items: [
                { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: handleLogout },
              ],
            }}
            placement="topLeft"
          >
            <button type="button" className="rt-user">
              <span className="rt-user-avatar">{(user.nickname || user.email).slice(0, 1).toUpperCase()}</span>
              <span className="rt-user-name">{user.nickname || user.email}</span>
              {user.role && <span className="rt-user-role">{user.role}</span>}
            </button>
          </Dropdown>
        </div>
      </aside>

      <main className="rt-main">
        <header className="rt-view-header">
          {currentCrumbs && currentCrumbs.length > 0 && (
            <div className="rt-crumb">
              {currentCrumbs.map((segment, index) => {
                const isLast = index === currentCrumbs.length - 1;
                return (
                  <span key={`${segment.label}-${index}`}>
                    {index > 0 && <span className="rt-crumb-sep">/</span>}
                    {segment.to && !isLast ? (
                      <Link to={segment.to} className="rt-crumb-link">{segment.label}</Link>
                    ) : (
                      <span className={isLast ? 'rt-crumb-page' : 'rt-crumb-group'}>
                        {segment.label}
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          )}
        </header>
        <div className="rt-content">
          <PlatformConfigProvider>
            <Outlet />
          </PlatformConfigProvider>
        </div>
      </main>
    </div>
  );
}

type CrumbSegment = { label: string; to?: string };

function getCurrentRouteCrumbs(pathname: string): CrumbSegment[] | undefined {
  if (/^\/enterprise-accounts-v2\/admin-creations\/[^/]+$/.test(pathname)) return [{label:'用户运营'},{label:'代办记录',to:'/enterprise-accounts-v2/admin-creations'},{label:'开通结果与详情'}];
  if (pathname === '/enterprise-accounts-v2/admin-creations') return [{label:'用户运营'},{label:'代办记录'}];
  if (pathname === '/enterprise-accounts-v2/admin-create') {
    return [{ label: '用户运营' }, { label: '代客创建企业账户' }];
  }
  // 企业账户详情：顶栏三级面包屑；「企业账户」可点回列表。
  if (/^\/enterprise-accounts-v2\/[^/]+$/.test(pathname)) {
    return [
      { label: '用户运营' },
      { label: '企业账户', to: '/enterprise-accounts-v2' },
      { label: '企业详情' },
    ];
  }

  const exact = ROUTE_TO_TITLE[pathname];
  if (exact) {
    return [
      { label: exact.group },
      { label: exact.page },
    ];
  }

  const parentPath = Object.keys(ROUTE_TO_TITLE)
    .filter((key) => key !== '/' && pathname.startsWith(`${key}/`))
    .sort((a, b) => b.length - a.length)[0];

  if (!parentPath) return undefined;
  const parent = ROUTE_TO_TITLE[parentPath];
  return [
    { label: parent.group },
    { label: parent.page },
  ];
}

function isMenuItemActive(pathname: string, key: string) {
  if (key === '/enterprise-accounts-v2' && pathname.startsWith('/enterprise-accounts-v2/admin-')) return false;
  if (key === '/') return pathname === '/';
  if (key === '/coding-plan') return pathname === key;
  return pathname === key || pathname.startsWith(`${key}/`);
}
