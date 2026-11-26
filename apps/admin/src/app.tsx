import { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { ConfigProvider, Spin, App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { ProductProvider } from './contexts/ProductContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RequirePermission } from './components/RequirePermission';
import AdminLayout from './layouts/AdminLayout';
import { antdTheme } from './styles/theme';
import { lazyWithChunkReload } from './utils/chunkReload';

const LoginPage = lazyWithChunkReload(() => import('./pages/Login'));
const DashboardPage = lazyWithChunkReload(() => import('./pages/Dashboard'));
const UsersPage = lazyWithChunkReload(() => import('./pages/Users'));
const UserDetailPage = lazyWithChunkReload(() => import('./pages/UserDetail'));
const MembersPage = lazyWithChunkReload(() => import('./pages/Members'));
const ChannelsPage = lazyWithChunkReload(() => import('./pages/Channels'));
const DeliverySettingsPage = lazyWithChunkReload(() => import('./pages/DeliverySettings'));
const TransactionsPage = lazyWithChunkReload(() => import('./pages/Transactions'));
const GatewayBillingEventsPage = lazyWithChunkReload(() => import('./pages/GatewayBillingEvents'));
const PublisherSyncJobsPage = lazyWithChunkReload(() => import('./pages/PublisherSyncJobs'));
const PlanTemplatesPage = lazyWithChunkReload(() => import('./pages/PlanTemplates'));
const PlanDetailPage = lazyWithChunkReload(() => import('./pages/PlanDetail'));
const ModelAccessPage = lazyWithChunkReload(() => import('./pages/ModelAccess'));
const RevenuePage = lazyWithChunkReload(() => import('./pages/Revenue'));
const FinanceOverviewPage = lazyWithChunkReload(() => import('./pages/FinanceOverview'));
const FinanceReportsPage = lazyWithChunkReload(() => import('./pages/FinanceReports'));
const FinanceReconciliationPage = lazyWithChunkReload(() => import('./pages/FinanceReconciliation'));
const FinanceExportJobsPage = lazyWithChunkReload(() => import('./pages/FinanceExportJobs'));
const HistoricalPlatformLossesPage = lazyWithChunkReload(() => import('./pages/HistoricalPlatformLosses'));
const CampaignsPage = lazyWithChunkReload(() => import('./pages/Campaigns'));
const BundlesPage = lazyWithChunkReload(() => import('./pages/Bundles'));
const DiscountCodesPage = lazyWithChunkReload(() => import('./pages/DiscountCodes'));
const SessionsPage = lazyWithChunkReload(() => import('./pages/Sessions'));
const MonitoringPage = lazyWithChunkReload(() => import('./pages/Monitoring'));
const AgentObservabilityPage = lazyWithChunkReload(() => import('./pages/AgentObservability'));
const AnnouncementsPage = lazyWithChunkReload(() => import('./pages/Announcements'));
const AuditLogsPage = lazyWithChunkReload(() => import('./pages/AuditLogs'));
const FeatureFlagsPage = lazyWithChunkReload(() => import('./pages/FeatureFlags'));
const SystemPromptsPage = lazyWithChunkReload(() => import('./pages/SystemPrompts'));
const SystemConfigPage = lazyWithChunkReload(() => import('./pages/SystemConfig'));
const ProductsPage = lazyWithChunkReload(() => import('./pages/Products'));
const BoosterPacksPage = lazyWithChunkReload(() => import('./pages/BoosterPacks'));
const OrdersPage = lazyWithChunkReload(() => import('./pages/Orders'));
const InvoicesPage = lazyWithChunkReload(() => import('./pages/Invoices'));
const PaymentConfigPage = lazyWithChunkReload(() => import('./pages/PaymentConfig'));
const RolesPage = lazyWithChunkReload(() => import('./pages/Roles'));
const ApiKeysPage = lazyWithChunkReload(() => import('./pages/ApiKeys'));
const PaygAccountsPage = lazyWithChunkReload(() => import('./pages/PaygAccounts'));
const ForbiddenPage = lazyWithChunkReload(() => import('./pages/Forbidden'));

// v2 新增页面 (stub,真实 UI 后续 task 实现)
const UserSegmentsPage = lazyWithChunkReload(() => import('./pages/UserSegments'));
const UserSegmentDetailPage = lazyWithChunkReload(() => import('./pages/UserSegments/detail'));
const TicketsPage = lazyWithChunkReload(() => import('./pages/Tickets'));
const TicketDetailPage = lazyWithChunkReload(() => import('./pages/Tickets/detail'));
const RiskUsersPage = lazyWithChunkReload(() => import('./pages/RiskUsers'));
const QuotaTemplatesPage = lazyWithChunkReload(() => import('./pages/QuotaTemplates'));
const SubscriptionsPage = lazyWithChunkReload(() => import('./pages/Subscriptions'));
const CodingPlanDesignPage = lazyWithChunkReload(() => import('./pages/CodingPlanDesign'));
const CodingPlanPlanDetailPage = lazyWithChunkReload(() => import('./pages/CodingPlanPlanDetail'));
const CodingPlanResalePage = lazyWithChunkReload(() => import('./pages/CodingPlanResale'));
const PaygPricingPage = lazyWithChunkReload(() => import('./pages/PaygPricing'));
const UsagePricingPoliciesPage = lazyWithChunkReload(() => import('./pages/UsagePricingPolicies'));
const RechargeTiersPage = lazyWithChunkReload(() => import('./pages/RechargeTiers'));
const CreditPolicyPage = lazyWithChunkReload(() => import('./pages/CreditPolicy'));
const GrantRulesPage = lazyWithChunkReload(() => import('./pages/GrantRules'));
const GrantRuleDetailPage = lazyWithChunkReload(() => import('./pages/GrantRules/detail'));
const ReferralsPage = lazyWithChunkReload(() => import('./pages/Referrals'));
const ModelsPage = lazyWithChunkReload(() => import('./pages/Models'));
const ModelDetailPage = lazyWithChunkReload(() => import('./pages/Models/detail'));
const ProviderCostPoliciesPage = lazyWithChunkReload(() => import('./pages/ProviderCostPolicies'));
const AlertsPage = lazyWithChunkReload(() => import('./pages/Alerts'));
const FunnelPage = lazyWithChunkReload(() => import('./pages/Funnel'));
const RiskRulesPage = lazyWithChunkReload(() => import('./pages/RiskRules'));
const EnterpriseAccountsPage = lazyWithChunkReload(() => import('./pages/EnterpriseAccounts'));
const EnterpriseAccountsV2Page = lazyWithChunkReload(() => import('./pages/EnterpriseAccountsV2'));
const EnterpriseAdminCreationPage = lazyWithChunkReload(() => import('./pages/EnterpriseAdminCreation'));
const EnterpriseAdminRecordsPage = lazyWithChunkReload(() => import('./pages/EnterpriseAdminRecords'));
const EnterpriseAdminResultPage = lazyWithChunkReload(() => import('./pages/EnterpriseAdminRecords/result'));
const EnterpriseAccountsV2DetailPage = lazyWithChunkReload(() => import('./pages/EnterpriseAccountsV2/detail'));

const Loading = () => <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;

function PlanTemplateRedirect() {
  const { id } = useParams();
  return <Navigate to={`/plans/${id}`} replace />;
}

export function App() {
  return (
    <ConfigProvider locale={zhCN} theme={antdTheme}>
      {/* AntdApp 提供 message / Modal / notification 的 React context,
          解决静态 message.success() 在 v5 下不显示 / 控制台 warn 的问题 */}
      <AntdApp>
        <ProductProvider>
          <BrowserRouter>
            <ErrorBoundary>
              <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route element={<AdminLayout />}>
                  {/* Redesign 新路由 */}
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/users" element={<UsersPage />} />
                  <Route path="/users/:id" element={<UserDetailPage />} />
                  <Route path="/team" element={<RequirePermission permission="admin.page.roles.view"><RolesPage /></RequirePermission>} />
                  <Route path="/products" element={<ProductsPage />} />
                  <Route path="/plans" element={<PlanTemplatesPage />} />
                  <Route path="/plans/:id" element={<PlanDetailPage />} />
                  <Route path="/payg-accounts" element={<PaygAccountsPage />} />
                  <Route path="/api-keys" element={<ApiKeysPage />} />
                  <Route path="/orders" element={<OrdersPage />} />
                  <Route path="/invoices" element={<InvoicesPage />} />
                  <Route path="/usage" element={<TransactionsPage />} />
                  <Route path="/gateway-billing-events" element={<GatewayBillingEventsPage />} />
                  <Route path="/publisher-sync-jobs" element={<PublisherSyncJobsPage />} />
                  <Route path="/revenue" element={<RevenuePage />} />
                  <Route path="/finance-overview" element={<FinanceOverviewPage />} />
                  <Route path="/finance-reports" element={<FinanceReportsPage />} />
                  <Route path="/finance-reconciliation" element={<FinanceReconciliationPage />} />
                  <Route path="/finance-export-jobs" element={<FinanceExportJobsPage />} />
                  <Route path="/historical-platform-losses" element={<HistoricalPlatformLossesPage />} />
                  <Route path="/enterprise-accounts" element={<EnterpriseAccountsPage />} />
                  <Route path="/enterprise-accounts-v2" element={<EnterpriseAccountsV2Page />} />
                  <Route path="/enterprise-accounts-v2/admin-create" element={<RequirePermission permission="admin.page.enterprise_accounts.review"><EnterpriseAdminCreationPage /></RequirePermission>} />
                  <Route path="/enterprise-accounts-v2/admin-creations" element={<RequirePermission permission="admin.page.enterprise_accounts.review"><EnterpriseAdminRecordsPage /></RequirePermission>} />
                  <Route path="/enterprise-accounts-v2/admin-creations/:requestId" element={<RequirePermission permission="admin.page.enterprise_accounts.review"><EnterpriseAdminResultPage /></RequirePermission>} />
                  <Route path="/enterprise-accounts-v2/:id" element={<EnterpriseAccountsV2DetailPage />} />
                  <Route path="/payment-config" element={<RequirePermission permission="admin.page.payment_config.view"><PaymentConfigPage /></RequirePermission>} />
                  <Route path="/channels" element={<ChannelsPage />} />
                  <Route path="/delivery-settings" element={<DeliverySettingsPage />} />
                  <Route path="/monitoring" element={<MonitoringPage />} />
                  <Route path="/agent-observability" element={<AgentObservabilityPage />} />
                  <Route path="/audit-logs" element={<AuditLogsPage />} />
                  <Route path="/announcements" element={<AnnouncementsPage />} />
                  <Route path="/feature-flags" element={<RequirePermission permission="admin.page.feature_flags.view"><FeatureFlagsPage /></RequirePermission>} />
                  <Route path="/system-prompts" element={<RequirePermission permission="admin.page.system_prompts.view"><SystemPromptsPage /></RequirePermission>} />
                  <Route path="/system-config" element={<RequirePermission permission="admin.page.system_config.view"><SystemConfigPage /></RequirePermission>} />
                  <Route path="/403" element={<ForbiddenPage />} />

                  {/* v2 新增路由 */}
                  <Route path="/user-segments" element={<UserSegmentsPage />} />
                  <Route path="/user-segments/:id" element={<UserSegmentDetailPage />} />
                  <Route path="/tickets" element={<TicketsPage />} />
                  <Route path="/tickets/:id" element={<TicketDetailPage />} />
                  <Route path="/risk-users" element={<RiskUsersPage />} />
                  <Route path="/quota-rules" element={<Navigate to="/coding-plan/quota-templates" replace />} />
                  <Route path="/subscriptions" element={<SubscriptionsPage />} />
                  <Route path="/coding-plan/design" element={<Navigate to="/coding-plan/self-managed-plans" replace />} />
                  <Route path="/coding-plan/self-managed-plans" element={<CodingPlanDesignPage />} />
                  <Route path="/coding-plan/third-party-plans" element={<CodingPlanResalePage />} />
                  <Route path="/coding-plan/resale-config" element={<CodingPlanResalePage />} />
                  <Route path="/coding-plan/resale-report" element={<CodingPlanResalePage />} />
                  <Route path="/coding-plan/quota-templates" element={<QuotaTemplatesPage />} />
                  <Route path="/coding-plan/plans/new" element={<RequirePermission permission="admin.page.coding_self_managed_plans.manage"><CodingPlanPlanDetailPage /></RequirePermission>} />
                  <Route path="/coding-plan/plans/:id" element={<RequirePermission permission="admin.page.coding_self_managed_plans.view"><CodingPlanPlanDetailPage /></RequirePermission>} />
                  <Route path="/coding-plan" element={<Navigate to="/coding-plan/third-party-plans" replace />} />
                  <Route path="/payg-pricing" element={<PaygPricingPage />} />
                  <Route path="/usage-pricing-policies" element={<UsagePricingPoliciesPage />} />
                  <Route path="/recharge-tiers" element={<RechargeTiersPage />} />
                  <Route path="/credit-policy" element={<CreditPolicyPage />} />
                  <Route path="/grant-rules" element={<GrantRulesPage />} />
                  <Route path="/grant-rules/:id" element={<GrantRuleDetailPage />} />
                  <Route path="/referrals" element={<ReferralsPage />} />
                  <Route path="/models" element={<ModelsPage />} />
                  <Route path="/models/:id" element={<ModelDetailPage />} />
                  <Route path="/provider-cost-policies" element={<ProviderCostPoliciesPage />} />
                  <Route path="/alerts" element={<AlertsPage />} />
                  <Route path="/funnel" element={<FunnelPage />} />
                  <Route path="/risk-rules" element={<RiskRulesPage />} />

                  {/* v2 重定向 */}
                  <Route path="/model-pricing" element={<Navigate to="/models" replace />} />

                  {/* 向后兼容:旧路径仍在使用,保留以避免外部链接失效 */}
                  <Route path="/members" element={<RequirePermission permission="admin.page.members.view"><MembersPage /></RequirePermission>} />
                  <Route path="/roles" element={<Navigate to="/team" replace />} />
                  <Route path="/transactions" element={<Navigate to="/usage" replace />} />
                  <Route path="/sessions" element={<SessionsPage />} />
                  <Route path="/plan-templates" element={<Navigate to="/plans" replace />} />
                  <Route path="/plan-templates/:id" element={<PlanTemplateRedirect />} />
                  <Route path="/booster-packs" element={<BoosterPacksPage />} />
                  <Route path="/bundles" element={<BundlesPage />} />
                  <Route path="/campaigns" element={<CampaignsPage />} />
                  <Route path="/discount-codes" element={<DiscountCodesPage />} />
                  <Route path="/model-access" element={<ModelAccessPage />} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
              </Suspense>
            </ErrorBoundary>
          </BrowserRouter>
        </ProductProvider>
      </AntdApp>
    </ConfigProvider>
  );
}
