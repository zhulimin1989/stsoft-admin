import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Radio,
  Select,
  Space,
  Switch,
  Tabs,
  Tooltip,
  message,
} from 'antd';
import dayjs from 'dayjs';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  PageHeader,
  DataTable,
  EmptyPlaceholder,
  StableNumberInput,
  Tag,
} from '../../components/common';
import {
  grantRuleApi,
  userSegmentApi,
  type CreditGrantRule,
  type GrantRedemption,
  type UserSegment,
} from '../../api/v2';
import { productApi } from '../../api/admin';
import { warnNonCritical } from '../../utils/logging';
import { usePermission } from '../../hooks/usePermission';

interface ProductRow {
  id: string;
  name: string;
}

interface FormValues {
  name: string;
  triggerType: CreditGrantRule['triggerType'];
  cronExpr?: string;
  segmentId?: string;
  rewardType: CreditGrantRule['rewardType'];
  rewardAmount: number;
  productId?: string;
  expirePolicy: CreditGrantRule['expirePolicy'];
  expireDays?: number;
  perUserLimit: number;
  globalDailyCap?: number;
  startAt?: dayjs.Dayjs;
  endAt?: dayjs.Dayjs;
  notifyType: CreditGrantRule['notifyType'];
  notifyTemplate?: string;
  isActive: boolean;
}

export default function GrantRuleDetailPage() {
  const canManage = usePermission('admin.page.grant_rules.manage');
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as string) || 'config';
  const isNew = !id || id === 'new';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [form] = Form.useForm<FormValues>();
  const [loading, setLoading] = useState(!isNew);
  const [segments, setSegments] = useState<UserSegment[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [rule, setRule] = useState<CreditGrantRule | null>(null);
  const [preview, setPreview] = useState<{
    matchedCount: number;
    estimatedTotalAmount: number;
  } | null>(null);
  const [redemptions, setRedemptions] = useState<GrantRedemption[]>([]);
  const [redempTotal, setRedempTotal] = useState(0);
  const [redempPage, setRedempPage] = useState(1);

  useEffect(() => {
    userSegmentApi
      .list({ pageSize: 100 })
      .then((res) => setSegments(res.items || []))
      .catch((error: unknown) => {
        warnNonCritical('GrantRuleDetail segment preload', error);
      });
    productApi
      .list()
      .then((list) => setProducts(list || []))
      .catch((error: unknown) => {
        warnNonCritical('GrantRuleDetail product preload', error);
      });
  }, []);

  const loadRule = async () => {
    if (isNew) return;
    setLoading(true);
    try {
      const r = await grantRuleApi.get(id!);
      setRule(r);
      form.setFieldsValue({
        name: r.name,
        triggerType: r.triggerType,
        cronExpr: r.cronExpr,
        segmentId: r.segmentId,
        rewardType: r.rewardType,
        rewardAmount: r.rewardAmount,
        productId: r.productId,
        expirePolicy: r.expirePolicy,
        expireDays: r.expireDays,
        perUserLimit: r.perUserLimit,
        globalDailyCap: r.globalDailyCap,
        startAt: r.startAt ? dayjs(r.startAt) : undefined,
        endAt: r.endAt ? dayjs(r.endAt) : undefined,
        notifyType: r.notifyType ?? 'NONE',
        notifyTemplate: r.notifyTemplate,
        isActive: r.isActive,
      });
    } catch {
      message.error('加载规则失败');
    } finally {
      setLoading(false);
    }
  };

  const loadRedemptions = async () => {
    if (isNew) return;
    try {
      const res = await grantRuleApi.listRedemptions(id!, {
        page: redempPage,
        pageSize: 20,
      });
      setRedemptions(res.items || []);
      setRedempTotal(res.total || 0);
    } catch (error: unknown) {
      warnNonCritical('GrantRuleDetail redemptions preload', error);
    }
  };

  useEffect(() => {
    loadRule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (activeTab === 'redemptions' && !isNew) {
      loadRedemptions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, redempPage]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const body: Partial<CreditGrantRule> = {
        ...values,
        startAt: values.startAt ? values.startAt.toISOString() : undefined,
        endAt: values.endAt ? values.endAt.toISOString() : undefined,
      };
      if (isNew) {
        const created = await grantRuleApi.create(body);
        message.success('已创建');
        navigate(`/grant-rules/${created.id}`);
      } else {
        await grantRuleApi.update(id!, body);
        message.success('已保存');
        loadRule();
      }
    } catch (err: unknown) {
      if ((err as { errorFields?: unknown })?.errorFields) return;
      message.error('保存失败');
    }
  };

  const handlePreview = async () => {
    if (isNew) {
      message.info('请先保存规则');
      return;
    }
    try {
      const res = await grantRuleApi.preview(id!);
      setPreview(res);
    } catch {
      message.error('预览失败');
    }
  };

  const handleManualTrigger = async () => {
    if (isNew) return;
    try {
      await grantRuleApi.manualTrigger(id!);
      message.success('已触发');
    } catch {
      message.error('触发失败');
    }
  };

  const redemptionColumns = [
    {
      title: '用户',
      dataIndex: 'userId',
      key: 'userId',
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v: string) =>
        v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—',
    },
    {
      title: '数额',
      dataIndex: 'amount',
      key: 'amount',
      width: 100,
    },
    {
      title: '是否已用完',
      dataIndex: 'isUsedUp',
      key: 'isUsedUp',
      width: 110,
      render: (v: boolean) =>
        v ? <Tag>已用完</Tag> : <Tag variant="success">未用完</Tag>,
    },
    {
      title: '是否已过期',
      dataIndex: 'isExpired',
      key: 'isExpired',
      width: 110,
      render: (v: boolean) =>
        v ? <Tag variant="error">已过期</Tag> : <Tag variant="success">未过期</Tag>,
    },
    {
      title: '过期时间',
      dataIndex: 'expiresAt',
      key: 'expiresAt',
      render: (v?: string) =>
        v ? dayjs(v).format('YYYY-MM-DD') : <span style={{ color: 'var(--text-muted)' }}>永久</span>,
    },
  ];

  const configContent = (
    <Card loading={loading}>
      <Form
        form={form}
        layout="vertical"
        disabled={!canManage}
        initialValues={{
          triggerType: 'DAILY_CRON',
          rewardType: 'CREDIT',
          rewardAmount: 100,
          expirePolicy: 'SAME_DAY_END',
          perUserLimit: 1,
          notifyType: 'NONE',
          isActive: true,
        }}
      >
        <Form.Item
          label="规则名"
          name="name"
          rules={[{ required: true, message: '必填' }]}
        >
          <Input placeholder="每日免费 300 积分" />
        </Form.Item>
        <Form.Item label="触发方式" name="triggerType" rules={[{ required: true }]}>
          <Radio.Group>
            <Radio value="DAILY_CRON">每日定时</Radio>
            <Radio value="FIRST_LOGIN">首次登录</Radio>
            <Radio value="DAILY_CHECKIN">每日签到</Radio>
            <Radio value="TASK_COMPLETE">任务完成</Radio>
            <Radio value="WEEKLY_CRON">每周定时</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item
          noStyle
          shouldUpdate={(prev, cur) => prev.triggerType !== cur.triggerType}
        >
          {({ getFieldValue }) =>
            getFieldValue('triggerType') === 'DAILY_CRON' ? (
              <Form.Item
                label="Cron 表达式"
                name="cronExpr"
                rules={[{ required: true }]}
                tooltip="标准 cron，例如 0 0 * * * 表示每天 0 点"
              >
                <Input placeholder="0 0 * * *" />
              </Form.Item>
            ) : null
          }
        </Form.Item>
        <Form.Item label="适用分群" name="segmentId">
          <Select
            allowClear
            placeholder="不选则所有用户"
            options={segments.map((s) => ({ label: s.name, value: s.id }))}
          />
        </Form.Item>

        <Space style={{ width: '100%' }} size="large">
          <Form.Item label="奖励类型" name="rewardType" rules={[{ required: true }]}>
            <Radio.Group>
              <Radio value="CREDIT">积分</Radio>
              <Radio value="BALANCE">余额</Radio>
              <Radio value="BOOSTER_PACK">加油包</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            label="奖励数额"
            name="rewardAmount"
            rules={[{ required: true, type: 'number', min: 1 }]}
          >
            <StableNumberInput min={1} precision={0} style={{ width: 160 }} />
          </Form.Item>
        </Space>
        <Form.Item label="适用产品（可选）" name="productId">
          <Select
            allowClear
            placeholder="不选则全产品"
            options={products.map((p) => ({ label: p.name, value: p.id }))}
          />
        </Form.Item>

        <Form.Item
          label="过期策略"
          name="expirePolicy"
          rules={[{ required: true }]}
          tooltip="“当天过期”按 UTC 时间边界计算（中国 UTC+8 用户每日 8:00 起算新一天）。如需精确到本地时区结束，请改用“N 天后过期”。"
        >
          <Radio.Group>
            <Radio value="PERMANENT">永久</Radio>
            <Radio value="SAME_DAY_END">当天过期（UTC）</Radio>
            <Radio value="N_DAYS">N 天后过期</Radio>
            <Radio value="NEXT_RESET">下次重置前</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item
          noStyle
          shouldUpdate={(prev, cur) => prev.expirePolicy !== cur.expirePolicy}
        >
          {({ getFieldValue }) =>
            getFieldValue('expirePolicy') === 'N_DAYS' ? (
              <Form.Item
                label="过期天数"
                name="expireDays"
                rules={[{ required: true }]}
              >
                <StableNumberInput min={1} precision={0} style={{ width: 160 }} />
              </Form.Item>
            ) : null
          }
        </Form.Item>

        <Space size="large">
          <Form.Item
            label={
              <Tooltip title="按 UTC 时区计算每日重置：中国 UTC+8 用户在每日 08:00 起算新的一天。同一规则同一用户在 UTC 当天累计触发不会超过此次数。">
                <span>每人每天限领</span>
              </Tooltip>
            }
            name="perUserLimit"
            rules={[{ required: true }]}
          >
            <StableNumberInput min={1} precision={0} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item
            label={
              <Tooltip title="本次执行最多发放的总额（不是用户数）。例如奖励额=100、上限=300，则只会发放给前 3 个匹配用户。">
                <span>全局每日上限（可选）</span>
              </Tooltip>
            }
            name="globalDailyCap"
          >
            <StableNumberInput min={0} precision={0} style={{ width: 160 }} />
          </Form.Item>
        </Space>

        <Space size="large">
          <Form.Item label="开始时间" name="startAt">
            <DatePicker showTime style={{ width: 200 }} />
          </Form.Item>
          <Form.Item label="结束时间" name="endAt">
            <DatePicker showTime style={{ width: 200 }} />
          </Form.Item>
        </Space>

        <Space size="large" style={{ width: '100%' }}>
          <Form.Item label="通知方式" name="notifyType">
            <Select
              style={{ width: 140 }}
              options={[
                { label: '站内信', value: 'INAPP' },
                { label: '邮件', value: 'EMAIL' },
                { label: '短信', value: 'SMS' },
                { label: '不通知', value: 'NONE' },
              ]}
            />
          </Form.Item>
          <Form.Item label="通知模板 ID" name="notifyTemplate">
            <Input placeholder="模板 ID" style={{ width: 240 }} />
          </Form.Item>
        </Space>

        <Form.Item label="启用" name="isActive" valuePropName="checked">
          <Switch />
        </Form.Item>

        <Space>
          <Button type="primary" disabled={!canManage} onClick={handleSave}>
            保存
          </Button>
          <Button disabled={false} onClick={() => navigate('/grant-rules')}>返回列表</Button>
        </Space>
      </Form>
    </Card>
  );

  const previewContent = (
    <Card>
      {isNew ? (
        <EmptyPlaceholder
          title="请先保存规则"
          description="保存后才能预览匹配用户数和模拟触发。"
        />
      ) : (
        <div>
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div>
              <Button onClick={handlePreview} type="primary">
                重新计算预览
              </Button>
            </div>
            {preview ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 16,
                }}
              >
                <Card size="small">
                  <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    当前匹配用户数
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 600 }}>
                    {preview.matchedCount.toLocaleString()}
                  </div>
                </Card>
                <Card size="small">
                  <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    预计今日发放总额
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 600 }}>
                    {preview.estimatedTotalAmount.toLocaleString()}
                  </div>
                </Card>
              </div>
            ) : (
              <EmptyPlaceholder
                title="暂无预览数据"
                description="点击上方按钮拉取最新预览。"
              />
            )}
            <div>
              <Button disabled={!canManage} onClick={handleManualTrigger}>模拟触发</Button>
              <span
                style={{ marginLeft: 12, color: 'var(--text-muted)', fontSize: 12 }}
              >
                注意：会真实发放奖励到匹配用户
              </span>
            </div>
          </Space>
        </div>
      )}
    </Card>
  );

  const redemptionsContent = (
    <Card>
      {isNew ? (
        <EmptyPlaceholder
          title="尚未保存"
          description="保存规则后才会有发放记录。"
        />
      ) : redemptions.length === 0 ? (
        <EmptyPlaceholder
          title="暂无发放记录"
          description="规则尚未触发或匹配到用户。"
        />
      ) : (
        <DataTable<GrantRedemption>
          columns={redemptionColumns}
          dataSource={redemptions}
          rowKey="id"
          listPagination={{
            current: redempPage,
            total: redempTotal,
            pageSize: 20,
            onChange: setRedempPage,
          }}
        />
      )}
    </Card>
  );

  return (
    <div>
      <PageHeader
        title={isNew ? '新建定时奖励' : rule?.name ?? '定时奖励详情'}
        subtitle={isNew ? '创建一个新的奖励规则' : '编辑奖励规则、预览匹配、查看发放记录'}
        breadcrumb={[
          { label: '定时奖励', to: '/grant-rules' },
          isNew ? '新建' : rule?.name ?? '...',
        ]}
      />

      {(
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            { key: 'config', label: '规则配置', children: configContent },
            { key: 'preview', label: '预览', children: previewContent },
            {
              key: 'redemptions',
              label: '发放记录',
              children: redemptionsContent,
            },
          ]}
        />
      )}
    </div>
  );
}
