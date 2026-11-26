import { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Form,
  Input,
  Switch,
  Button,
  Select,
  message,
  Typography,
  Spin,
  Alert,
} from 'antd';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { PageHeader, StableNumberInput } from '../../components/common';
import { systemConfigApi } from '../../api/admin';
import { usePlatformConfig } from '../../contexts/PlatformConfigContext';
import { usePermission } from '../../hooks/usePermission';

interface BasicInfo {
  siteName?: string;
  logoUrl?: string;
  themeColor?: string;
  faviconUrl?: string;
}

interface EmailConfig {
  smtpHost?: string;
  smtpPort?: number;
  smtpUsername?: string;
  smtpPassword?: string;
  senderEmail?: string;
  emailTemplate?: string;
}

interface PlatformConfig {
  region?: 'overseas' | 'domestic';
  currency?: string;
  defaultLanguage?: 'en' | 'zh';
}

function normalizeStorageProvider(value: unknown, config?: StorageConfig): NonNullable<StorageConfig['provider']> {
  const raw = String(value ?? config?.storageProvider ?? config?.objectStoreProvider ?? '').trim().toLowerCase();
  if (raw === 'aliyun_oss' || raw === 'aliyun-oss' || raw === 'oss') return 'aliyun_oss';
  if (raw === 's3' || raw === 'aws_s3' || raw === 'aws-s3') return 's3';
  return config?.ossEndpoint ? 'aliyun_oss' : 's3';
}

interface OAuthConfig {
  // Auth0（国际版）公开参数
  auth0Domain?: string;
  auth0ClientId?: string;
  auth0DbConnection?: string;
  // Authing（国内版）公开参数
  authingAppHost?: string;
  authingAppId?: string;
  authingWechatConnection?: string;
}

interface DeploymentConfigSyncStatus {
  version?: string;
  status?: 'synced' | 'degraded';
  lastAttemptAt?: string;
  user?: { ok?: boolean; error?: string };
  billing?: { ok?: boolean; error?: string };
}

interface ApiGatewayConfig {
  defaultTimeoutMs?: number;
  rateLimitPerMin?: number;
  retryStrategy?: string;
}

interface StorageConfig {
  provider?: 's3' | 'aliyun_oss';
  storageProvider?: string;
  objectStoreProvider?: string;
  bucket?: string;
  s3Region?: string;
  s3Endpoint?: string;
  s3Prefix?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  ossEndpoint?: string;
  s3ForcePathStyle?: boolean;
  /** @deprecated 旧版字段，后端仍兼容。 */
  accessKey?: string;
}

interface LogConfig {
  retentionDays?: number;
  level?: string;
}

interface MaintenanceConfig {
  enabled?: boolean;
  announcement?: string;
}

interface SystemConfig {
  basicInfo: BasicInfo;
  emailConfig: EmailConfig;
  platformConfig: PlatformConfig;
  oauthConfig: OAuthConfig;
  apiGatewayConfig: ApiGatewayConfig;
  storageConfig: StorageConfig;
  logConfig: LogConfig;
  maintenanceConfig: MaintenanceConfig;
  // Preserved legacy fields
  modelConfig?: Record<string, unknown>;
  featureFlags?: Record<string, unknown>;
  paymentConfig?: Record<string, unknown>;
  deploymentConfigSyncStatus?: DeploymentConfigSyncStatus;
}

const EMPTY_CONFIG: SystemConfig = {
  basicInfo: {},
  emailConfig: { smtpPort: 587 },
  platformConfig: {},
  oauthConfig: {},
  apiGatewayConfig: { defaultTimeoutMs: 30000, rateLimitPerMin: 60, retryStrategy: 'exponential' },
  storageConfig: {},
  logConfig: { retentionDays: 30, level: 'info' },
  maintenanceConfig: { enabled: false },
};

function isLoadedSystemConfig(value: unknown): value is Partial<SystemConfig> & {
  platformConfig: PlatformConfig & { region: 'overseas' | 'domestic'; currency: string };
} {
  if (!value || typeof value !== 'object' || Object.keys(value).length === 0) return false;
  const platformConfig = (value as { platformConfig?: unknown }).platformConfig;
  if (!platformConfig || typeof platformConfig !== 'object') return false;
  const candidate = platformConfig as PlatformConfig;
  return (
    (candidate.region === 'overseas' || candidate.region === 'domestic') &&
    typeof candidate.currency === 'string' &&
    candidate.currency.trim().length > 0
  );
}

interface SectionCardProps<T extends object> {
  title: string;
  description?: string;
  initialValues: T;
  fullConfig: SystemConfig;
  configKey: keyof SystemConfig;
  canManage: boolean;
  onSaved: (next: SystemConfig) => void;
  afterSave?: () => Promise<void>;
  /** 表单值实时变化回调（用于跨卡片联动，如 provider 切换驱动 OAuth 字段显隐）。 */
  onValuesChange?: (changedValues: Partial<T>, allValues: T) => void;
  children: React.ReactNode;
}

function SectionCard<T extends object>({
  title,
  description,
  initialValues,
  fullConfig,
  configKey,
  canManage,
  onSaved,
  afterSave,
  onValuesChange,
  children,
}: SectionCardProps<T>) {
  const [form] = Form.useForm<T>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    form.setFieldsValue(initialValues as never);
  }, [initialValues, form]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const values = await form.validateFields();
      const merged = { ...fullConfig, [configKey]: values } as SystemConfig;
      const result = await systemConfigApi.update(
        { [configKey]: values } as unknown as Record<string, unknown>,
      ) as { deploymentConfigSyncStatus?: DeploymentConfigSyncStatus } | null;
      if (result?.deploymentConfigSyncStatus?.status === 'degraded') {
        message.warning(`${title}已保存；部分服务尚未生效，后台正在自动重试`);
      } else {
        message.success(`${title} 已保存`);
      }
      onSaved(merged);
      await afterSave?.().catch(() => undefined);
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title={
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
          {description ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted, #888)', fontWeight: 400, marginTop: 2 }}>
              {description}
            </div>
          ) : null}
        </div>
      }
      bordered={false}
      style={{ marginBottom: 16 }}
      extra={
        <Button
          type="primary"
          size="small"
          icon={<SaveOutlined />}
          loading={saving}
          onClick={handleSave}
          disabled={!canManage}
        >
          保存
        </Button>
      }
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={initialValues}
        onValuesChange={onValuesChange}
        style={{ maxWidth: 720 }}
      >
        {children}
      </Form>
    </Card>
  );
}

export default function SystemConfigPage() {
  const canManage = usePermission('admin.page.system_config.manage');
  const { setCurrency: setRuntimeCurrency } = usePlatformConfig();
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeRegion, setActiveRegion] = useState<PlatformConfig['region']>();
  const [activeStorageProvider, setActiveStorageProvider] = useState<NonNullable<StorageConfig['provider']>>('s3');

  const handleSaved = useCallback((next: SystemConfig) => {
    setConfig(next);
    setRuntimeCurrency(next.platformConfig.currency);
    if (next.platformConfig.region) setActiveRegion(next.platformConfig.region);
    setActiveStorageProvider(normalizeStorageProvider(next.storageConfig.provider, next.storageConfig));
  }, [setRuntimeCurrency]);

  const reloadConfig = useCallback(async () => {
    const data = await systemConfigApi.get();
    if (!isLoadedSystemConfig(data)) {
      throw new Error('系统配置响应缺少有效的部署区域或币种');
    }
    const loadedRegion = data.platformConfig.region;
    const loadedStorageProvider = normalizeStorageProvider(data.storageConfig?.provider, data.storageConfig);
    setConfig((prev) => {
      const base = prev ?? EMPTY_CONFIG;
      return {
        ...base,
        basicInfo: { ...base.basicInfo, ...(data.basicInfo || {}) },
        emailConfig: { ...base.emailConfig, ...(data.emailConfig || {}) },
        platformConfig: { ...base.platformConfig, ...data.platformConfig },
        oauthConfig: { ...base.oauthConfig, ...(data.oauthConfig || {}) },
        apiGatewayConfig: { ...base.apiGatewayConfig, ...(data.apiGatewayConfig || {}) },
        storageConfig: {
          ...base.storageConfig,
          ...(data.storageConfig || {}),
          provider: loadedStorageProvider,
        },
        logConfig: { ...base.logConfig, ...(data.logConfig || {}) },
        maintenanceConfig: { ...base.maintenanceConfig, ...(data.maintenanceConfig || {}) },
        modelConfig: data.modelConfig ?? base.modelConfig,
        featureFlags: data.featureFlags ?? base.featureFlags,
        paymentConfig: data.paymentConfig ?? base.paymentConfig,
        deploymentConfigSyncStatus:
          data.deploymentConfigSyncStatus ?? base.deploymentConfigSyncStatus,
      };
    });
    setActiveRegion(loadedRegion);
    setActiveStorageProvider(loadedStorageProvider);
  }, []);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      await reloadConfig();
    } catch (error) {
      const detail = error instanceof Error && error.message ? `：${error.message}` : '';
      setLoadError(`无法加载系统配置${detail}`);
    } finally {
      setLoading(false);
    }
  }, [reloadConfig]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  if (loading) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }

  if (loadError || !config) {
    return (
      <div>
        <PageHeader
          title="系统设置"
          subtitle="部署区域是登录身份源的唯一真相源：国内自动使用 Authing，海外自动使用 Auth0"
        />
        <Alert
          type="error"
          showIcon
          message="系统配置加载失败"
          description={`${loadError ?? '未获取到有效配置'}。为避免覆盖当前部署设置，编辑和保存已停用。`}
          action={(
            <Button icon={<ReloadOutlined />} onClick={() => void loadConfig()}>
              重试加载
            </Button>
          )}
        />
      </div>
    );
  }

  // OAuth 卡片字段按部署区域派生的 provider 显隐。用 Form.Item hidden 而非卸载，
  // 隐藏字段仍保留值并随保存提交，避免切换 provider 后保存抹掉另一套配置。
  const showAuth0Fields = activeRegion === 'overseas';
  const showAuthingFields = activeRegion === 'domestic';

  return (
    <div>
      <PageHeader
        title="系统设置"
        subtitle="部署区域是登录身份源的唯一真相源：国内自动使用 Authing，海外自动使用 Auth0"
      />

      {config.deploymentConfigSyncStatus?.status === 'degraded' ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="部署配置正在自动重试下发"
          description={`用户门户：${config.deploymentConfigSyncStatus.user?.ok ? '已生效' : '待同步'}；Billing：${config.deploymentConfigSyncStatus.billing?.ok ? '已生效' : '待同步'}`}
        />
      ) : null}

      <SectionCard<BasicInfo>
        title="基础信息"
        description="站点品牌信息：站点名 / Logo / 主题色 / favicon"
        initialValues={config.basicInfo}
        fullConfig={config}
        configKey="basicInfo"
        canManage={canManage}
        onSaved={handleSaved}
      >
        <Form.Item name="siteName" label="站点名">
          <Input placeholder="后台站点名称" />
        </Form.Item>
        <Form.Item name="logoUrl" label="Logo URL">
          <Input placeholder="https://..." />
        </Form.Item>
        <Form.Item name="themeColor" label="主题色">
          <Input placeholder="#1a1a1a" />
        </Form.Item>
        <Form.Item name="faviconUrl" label="Favicon URL">
          <Input placeholder="https://..." />
        </Form.Item>
      </SectionCard>

      <SectionCard<EmailConfig>
        title="邮件"
        description="SMTP 服务器与发件人配置"
        initialValues={config.emailConfig}
        fullConfig={config}
        configKey="emailConfig"
        canManage={canManage}
        onSaved={handleSaved}
      >
        <Form.Item name="smtpHost" label="SMTP 主机">
          <Input placeholder="smtp.example.com" />
        </Form.Item>
        <Form.Item name="smtpPort" label="SMTP 端口">
          <StableNumberInput min={1} max={65535} precision={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="smtpUsername" label="SMTP 用户名">
          <Input placeholder="user@example.com" />
        </Form.Item>
        <Form.Item name="smtpPassword" label="SMTP 密码">
          <Input.Password placeholder="留空保持原值" />
        </Form.Item>
        <Form.Item name="senderEmail" label="发件邮箱">
          <Input placeholder="noreply@example.com" />
        </Form.Item>
        <Form.Item name="emailTemplate" label="模板配置">
          <Input.TextArea rows={3} placeholder="模板键值对或模板 ID" />
        </Form.Item>
      </SectionCard>

      <SectionCard<PlatformConfig>
        title="平台运行时"
        description="不同部署的基础运行时口径：部署区域、系统币种、默认语言"
        initialValues={config.platformConfig}
        fullConfig={config}
        configKey="platformConfig"
        canManage={canManage}
        onSaved={handleSaved}
        afterSave={reloadConfig}
        onValuesChange={(_, all) => {
          if (all.region) setActiveRegion(all.region);
        }}
      >
        <Form.Item name="region" label="部署区域" rules={[{ required: true, message: '请选择部署区域' }]}>
          <Select
            options={[
              { value: 'overseas', label: '海外部署' },
              { value: 'domestic', label: '国内部署' },
            ]}
          />
        </Form.Item>
        <Form.Item name="currency" label="系统币种" rules={[{ required: true, message: '请选择系统币种' }]}>
          <Select
            showSearch
            options={[
              { value: 'usd', label: 'USD - 美元' },
              { value: 'cny', label: 'CNY - 人民币' },
              { value: 'hkd', label: 'HKD - 港币' },
              { value: 'sgd', label: 'SGD - 新加坡元' },
              { value: 'eur', label: 'EUR - 欧元' },
              { value: 'gbp', label: 'GBP - 英镑' },
              { value: 'jpy', label: 'JPY - 日元' },
            ]}
          />
        </Form.Item>
        <Form.Item name="defaultLanguage" label="默认语言" rules={[{ required: true, message: '请选择默认语言' }]}>
          <Select
            options={[
              { value: 'en', label: 'English' },
              { value: 'zh', label: '简体中文' },
            ]}
          />
        </Form.Item>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          保存后生成一个带版本号的原子快照并可靠下发到用户门户与 Billing；国内自动使用 Authing，海外自动使用 Auth0。
        </Typography.Text>
      </SectionCard>

      <SectionCard<OAuthConfig>
        title="OAuth"
        description="登录身份源公开参数（随部署区域显示对应字段）。仅公开参数进入原子快照；Client/App Secret 仍留在服务端环境变量。"
        initialValues={config.oauthConfig}
        fullConfig={config}
        configKey="oauthConfig"
        canManage={canManage}
        onSaved={handleSaved}
        afterSave={reloadConfig}
      >
        <Form.Item name="auth0Domain" label="Auth0 Domain（国际版）" hidden={!showAuth0Fields}>
          <Input placeholder="your-tenant.auth0.com" />
        </Form.Item>
        <Form.Item name="auth0ClientId" label="Auth0 Client ID（国际版）" hidden={!showAuth0Fields}>
          <Input placeholder="auth0 client id" />
        </Form.Item>
        <Form.Item name="auth0DbConnection" label="Auth0 DB Connection（密码重置用）" hidden={!showAuth0Fields}>
          <Input placeholder="Username-Password-Authentication" />
        </Form.Item>
        <Form.Item name="authingAppHost" label="Authing App Host（国内版）" hidden={!showAuthingFields}>
          <Input placeholder="https://xxx.authing.cn" />
        </Form.Item>
        <Form.Item name="authingAppId" label="Authing App ID（国内版）" hidden={!showAuthingFields}>
          <Input placeholder="authing app id" />
        </Form.Item>
        <Form.Item name="authingWechatConnection" label="Authing 微信 Connection（可选）" hidden={!showAuthingFields}>
          <Input placeholder="微信社会化登录身份源标识" />
        </Form.Item>
      </SectionCard>

      <SectionCard<ApiGatewayConfig>
        title="API 网关"
        description="默认超时、限流默认值与重试策略"
        initialValues={config.apiGatewayConfig}
        fullConfig={config}
        configKey="apiGatewayConfig"
        canManage={canManage}
        onSaved={handleSaved}
      >
        <Form.Item name="defaultTimeoutMs" label="默认超时（毫秒）">
          <StableNumberInput min={1000} max={600000} step={1000} precision={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="rateLimitPerMin" label="限流默认值（次/分钟）">
          <StableNumberInput min={1} precision={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="retryStrategy" label="重试策略">
          <Select
            options={[
              { value: 'none', label: '不重试' },
              { value: 'fixed', label: '固定间隔' },
              { value: 'exponential', label: '指数退避' },
            ]}
          />
        </Form.Item>
      </SectionCard>

      <SectionCard<StorageConfig>
        title="存储"
        description="运行时对象存储参数；发票上传下载会在实际开票/下载时校验有效配置。"
        initialValues={config.storageConfig}
        fullConfig={config}
        configKey="storageConfig"
        canManage={canManage}
        onSaved={handleSaved}
        afterSave={reloadConfig}
        onValuesChange={(_changed, all) => {
          setActiveStorageProvider(normalizeStorageProvider(all.provider, all));
        }}
      >
        <Form.Item
          name="provider"
          label="Provider"
          initialValue="s3"
          rules={[{ required: true, message: '请选择对象存储 Provider' }]}
        >
          <Select
            options={[
              { value: 's3', label: 'S3' },
              { value: 'aliyun_oss', label: '阿里云 OSS' },
            ]}
          />
        </Form.Item>
        <Form.Item name="s3Endpoint" label="S3 endpoint" hidden={activeStorageProvider !== 's3'}>
          <Input placeholder="https://s3.amazonaws.com" />
        </Form.Item>
        <Form.Item name="s3Prefix" label="S3 Key Prefix">
          <Input placeholder="可选，例如 billing-test" />
        </Form.Item>
        <Form.Item
          name="s3ForcePathStyle"
          label="S3 force path style"
          valuePropName="checked"
          hidden={activeStorageProvider !== 's3'}
        >
          <Switch />
        </Form.Item>
        <Form.Item
          name="s3AccessKeyId"
          label={activeStorageProvider === 'aliyun_oss' ? 'OSS Access Key ID' : 'S3 Access Key ID'}
          rules={
            activeStorageProvider === 'aliyun_oss'
              ? [{ required: true, whitespace: true, message: '请填写 OSS Access Key ID' }]
              : undefined
          }
        >
          <Input placeholder={activeStorageProvider === 'aliyun_oss' ? '必填' : '留空使用服务端默认凭据链'} />
        </Form.Item>
        <Form.Item
          name="s3SecretAccessKey"
          label={activeStorageProvider === 'aliyun_oss' ? 'OSS Access Key Secret' : 'S3 Secret Access Key'}
          rules={
            activeStorageProvider === 'aliyun_oss'
              ? [{ required: true, whitespace: true, message: '请填写 OSS Access Key Secret' }]
              : undefined
          }
        >
          <Input.Password placeholder={activeStorageProvider === 'aliyun_oss' ? '必填' : '留空使用服务端默认凭据链'} />
        </Form.Item>
        <Form.Item name="ossEndpoint" label="OSS endpoint" hidden={activeStorageProvider !== 'aliyun_oss'}>
          <Input placeholder="https://oss-cn-hangzhou.aliyuncs.com" />
        </Form.Item>
      </SectionCard>

      <SectionCard<LogConfig>
        title="日志"
        description="日志保留天数与等级"
        initialValues={config.logConfig}
        fullConfig={config}
        configKey="logConfig"
        canManage={canManage}
        onSaved={handleSaved}
      >
        <Form.Item name="retentionDays" label="保留天数">
          <StableNumberInput min={1} max={3650} precision={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="level" label="等级">
          <Select
            options={[
              { value: 'debug', label: 'debug' },
              { value: 'info', label: 'info' },
              { value: 'warn', label: 'warn' },
              { value: 'error', label: 'error' },
            ]}
          />
        </Form.Item>
      </SectionCard>

      <SectionCard<MaintenanceConfig>
        title="维护模式"
        description="开启后所有用户将无法访问平台"
        initialValues={config.maintenanceConfig}
        fullConfig={config}
        configKey="maintenanceConfig"
        canManage={canManage}
        onSaved={handleSaved}
      >
        <Form.Item name="enabled" label="维护开关" valuePropName="checked">
          <Switch checkedChildren="维护中" unCheckedChildren="正常" />
        </Form.Item>
        <Form.Item name="announcement" label="公告文案">
          <Input.TextArea rows={4} placeholder="维护期间向用户展示的提示文案" />
        </Form.Item>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          建议在切换维护模式前提前广播公告并通知值班同学。
        </Typography.Text>
      </SectionCard>
    </div>
  );
}
