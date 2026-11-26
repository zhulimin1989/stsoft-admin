import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Tabs,
  Typography,
  App,
} from 'antd';
import { CopyOutlined, LinkOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  PageHeader,
  StatCard,
  StatCardGroup,
  DataTable,
  Tag,
  EmptyPlaceholder,
  StableNumberInput,
} from '../../components/common';
import {
  referralApi,
  type ReferralProgram,
  type ReferralRedemption,
  type ReferralSummary,
  type ClickSources,
  type ClickSourceRow,
  type ReferralCodeRow,
} from '../../api/v2';
import { productApi } from '../../api/admin';
import { warnNonCritical } from '../../utils/logging';
import { usePermission } from '../../hooks/usePermission';

interface ProductRow {
  id: string;
  name: string;
}

interface LeaderboardRow {
  userId: string;
  email: string | null;
  phone: string | null;
  nickname: string | null;
  inviteCount: number;
  rewardTotal: number;
}

// 用户单元格:邮箱 / 手机号 / 昵称(有则显示;手机注册用户的手机号常存在 nickname)
// + 用户ID(始终显示,便于精确定位)
/**
 * 邀请人/被邀请人单元格:**先显示能联系到人的东西**(手机号或邮箱),有姓名再跟 ` / 姓名`。
 *
 * 为什么这个顺序:刚注册的用户往往只有手机号、没设昵称,而他同样可以去邀请别人。
 * 早先按「email 行 / phone 行 / 昵称行」分三行展示,遇到镜像里联系方式为空的用户
 * 就只剩昵称甚至只剩 UUID,运营认不出是谁。海外用户没有手机号、只有邮箱,所以
 * 两者取其一即可(admin-api 已用 user 域权威数据补齐 billing 镜像缺失的字段)。
 */
function renderUserCell(
  id: string,
  contact?: {
    email?: string | null;
    phone?: string | null;
    nickname?: string | null;
  } | null,
) {
  const contactText = contact?.phone?.trim() || contact?.email?.trim() || '';
  const nick = contact?.nickname?.trim() || '';
  // 昵称与联系方式相同时不重复显示(注册时昵称默认就是手机号)
  const showNick = Boolean(nick) && nick !== contactText;
  const primary = contactText
    ? showNick
      ? `${contactText} / ${nick}`
      : contactText
    : showNick
      ? nick
      : '';
  return (
    <div style={{ lineHeight: 1.35 }}>
      {primary ? <div>{primary}</div> : null}
      <div
        style={{
          fontSize: 12,
          color: 'var(--text-muted)',
          wordBreak: 'break-all',
        }}
      >
        {id}
      </div>
    </div>
  );
}

const REWARD_CONDITION_LABEL: Record<
  ReferralProgram['rewardCondition'],
  string
> = {
  REGISTER: '注册',
  FIRST_RECHARGE: '首次充值',
  FIRST_SUBSCRIBE: '首次订阅',
};

interface FormValues {
  name: string;
  rewardCondition: ReferralProgram['rewardCondition'];
  productId?: string;
  range?: [dayjs.Dayjs, dayjs.Dayjs];
  sameIpLimit?: number;
  sameDeviceLimit?: number;
  perUserInviteLimit?: number;
  isActive: boolean;
}

interface LinkFormValues {
  inviterUser: string;
  landingUrl: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
}

function apiErrorMessage(err: unknown, fallback: string): string {
  const response = err as {
    response?: { data?: { message?: string | string[] } };
    message?: string;
  };
  const message = response.response?.data?.message;
  if (Array.isArray(message)) return message.join('；') || fallback;
  return message || response.message || fallback;
}

function trimOptional(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function defaultLandingUrl(): string {
  const configured = import.meta.env.VITE_USER_APP_URL?.trim();
  const base = (configured || window.location.origin).replace(/\/+$/, '');
  return base.endsWith('/register') ? base : `${base}/register`;
}

function buildPromotionLink(values: LinkFormValues, code: string): string {
  const url = new URL(values.landingUrl.trim(), window.location.origin);
  url.searchParams.set('ref', code);

  const utmSource = trimOptional(values.utmSource);
  const utmMedium = trimOptional(values.utmMedium);
  const utmCampaign = trimOptional(values.utmCampaign);
  const utmContent = trimOptional(values.utmContent);

  if (utmSource) url.searchParams.set('utm_source', utmSource);
  if (utmMedium) url.searchParams.set('utm_medium', utmMedium);
  if (utmCampaign) url.searchParams.set('utm_campaign', utmCampaign);
  if (utmContent) url.searchParams.set('utm_content', utmContent);

  return url.toString();
}

function timeoutAfter(ms: number): Promise<'timeout'> {
  return new Promise((resolve) => {
    window.setTimeout(() => resolve('timeout'), ms);
  });
}

// 复制文本:优先 navigator.clipboard(需 HTTPS/安全上下文),HTTP 下回退 execCommand。
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function clickSourceColumns(label: string) {
  return [
    {
      title: label,
      dataIndex: 'source',
      key: 'source',
      render: (v: string) => (
        <span style={{ wordBreak: 'break-all' }}>{v}</span>
      ),
    },
    { title: 'UV', dataIndex: 'uv', key: 'uv', width: 80 },
    { title: '点击', dataIndex: 'pv', key: 'pv', width: 80 },
  ];
}

export default function ReferralsPage() {
  const canManage = usePermission('admin.page.referrals.manage');
  // 用 App 上下文的 message 实例:根部套了 antd <App>,静态 message 在 Modal 内弹不出/被遮挡
  const { message } = App.useApp();
  const [programs, setPrograms] = useState<ReferralProgram[]>([]);
  const [redemptions, setRedemptions] = useState<ReferralRedemption[]>([]);
  const [redempTotal, setRedempTotal] = useState(0);
  const [redempPage, setRedempPage] = useState(1);
  const [redemptionsLoading, setRedemptionsLoading] = useState(true);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  // 排行榜下钻:每个邀请人展开后其被邀请人明细(懒加载)
  const [inviteeDetails, setInviteeDetails] = useState<
    Record<string, ReferralRedemption[]>
  >({});
  const [inviteeLoading, setInviteeLoading] = useState<Record<string, boolean>>(
    {},
  );
  // 程序列表下钻:每个程序展开后的点击来源分布(懒加载)
  const [clickSources, setClickSources] = useState<
    Record<string, ClickSources>
  >({});
  const [clickSourcesLoading, setClickSourcesLoading] = useState<
    Record<string, boolean>
  >({});
  const [summary, setSummary] = useState<ReferralSummary | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stubMode, setStubMode] = useState(false);
  const [activeTab, setActiveTab] = useState('programs');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ReferralProgram | null>(null);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkProgram, setLinkProgram] = useState<ReferralProgram | null>(null);
  const [linkGenerating, setLinkGenerating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [generatedLink, setGeneratedLink] = useState('');
  const [generationStatus, setGenerationStatus] = useState('');
  const [generationError, setGenerationError] = useState('');
  // 该程序已生成的邀请码(回显),打开弹窗时从后端拉
  const [existingCodes, setExistingCodes] = useState<ReferralCodeRow[]>([]);
  const redemptionsRequestRef = useRef(0);
  const existingCodesRequestRef = useRef(0);
  const generationRequestRef = useRef(0);
  const pendingGenerationRef = useRef<Promise<{ code: string }> | null>(null);
  const linkProgramIdRef = useRef<string | null>(null);
  const [form] = Form.useForm<FormValues>();
  const [linkForm] = Form.useForm<LinkFormValues>();

  const fetchPrograms = useCallback(async () => {
    setLoading(true);
    try {
      const res = await referralApi.listPrograms();
      setPrograms(res.items || []);
      setStubMode(false);
    } catch (err: unknown) {
      const code = (err as { response?: { status?: number } })?.response
        ?.status;
      if (code === 404) {
        setStubMode(true);
        setPrograms([]);
      } else {
        message.error('加载邀请程序失败');
      }
    } finally {
      setLoading(false);
    }
  }, [message]);

  const fetchRedemptions = useCallback(async () => {
    const requestId = redemptionsRequestRef.current + 1;
    redemptionsRequestRef.current = requestId;
    setRedemptionsLoading(true);
    try {
      const res = await referralApi.listRedemptions({
        page: redempPage,
        pageSize: 20,
      });
      if (requestId !== redemptionsRequestRef.current) return;
      setRedemptions(res.items || []);
      setRedempTotal(res.total || 0);
    } catch (error: unknown) {
      warnNonCritical('Referrals redemptions preload', error);
    } finally {
      if (requestId === redemptionsRequestRef.current) setRedemptionsLoading(false);
    }
  }, [redempPage]);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await referralApi.leaderboard({ days: 30 });
      setLeaderboard(res.items || []);
    } catch (error: unknown) {
      warnNonCritical('Referrals leaderboard preload', error);
    }
  }, []);

  // 排行榜下钻:懒加载某邀请人的被邀请人明细(展开时触发,已加载则跳过)
  const loadInvitees = async (inviterUserId: string) => {
    if (inviteeDetails[inviterUserId]) return;
    setInviteeLoading((s) => ({ ...s, [inviterUserId]: true }));
    try {
      const res = await referralApi.listRedemptions({
        inviterUserId,
        triggered: true,
        page: 1,
        pageSize: 100,
      });
      setInviteeDetails((s) => ({ ...s, [inviterUserId]: res.items || [] }));
    } catch (error: unknown) {
      warnNonCritical('Referrals invitee drilldown', error);
    } finally {
      setInviteeLoading((s) => ({ ...s, [inviterUserId]: false }));
    }
  };

  // 程序列表下钻:懒加载某程序的点击来源分布(referrer + utm_source)
  const loadClickSources = async (programId: string) => {
    if (clickSources[programId]) return;
    setClickSourcesLoading((s) => ({ ...s, [programId]: true }));
    try {
      const res = await referralApi.clickSources(programId);
      setClickSources((s) => ({ ...s, [programId]: res }));
    } catch (error: unknown) {
      warnNonCritical('Referrals click-sources drilldown', error);
    } finally {
      setClickSourcesLoading((s) => ({ ...s, [programId]: false }));
    }
  };

  const fetchSummary = useCallback(async () => {
    try {
      const res = await referralApi.summary();
      setSummary(res);
    } catch (error: unknown) {
      warnNonCritical('Referrals summary preload', error);
    }
  }, []);

  // 刷新当前页数据:看板 + 程序列表 + 当前 tab,并清掉下钻缓存强制重拉
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setInviteeDetails({});
    setClickSources({});
    try {
      await Promise.all([
        fetchSummary(),
        fetchPrograms(),
        activeTab === 'redemptions' ? fetchRedemptions() : Promise.resolve(),
        activeTab === 'leaderboard' ? fetchLeaderboard() : Promise.resolve(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [
    activeTab,
    fetchSummary,
    fetchPrograms,
    fetchRedemptions,
    fetchLeaderboard,
  ]);

  useEffect(() => {
    productApi
      .list()
      .then((list) => setProducts(list || []))
      .catch((error: unknown) => {
        warnNonCritical('Referrals product preload', error);
      });
    fetchPrograms();
    fetchSummary();
  }, [fetchPrograms, fetchSummary]);

  useEffect(() => {
    if (activeTab === 'redemptions') fetchRedemptions();
    if (activeTab === 'leaderboard') fetchLeaderboard();
  }, [activeTab, fetchLeaderboard, fetchRedemptions]);

  const stats = useMemo(() => {
    const active = programs.filter((p) => p.isActive).length;
    if (!summary) {
      return {
        active,
        inviters: '—',
        invitees: '—',
        conversion: '—',
        completed: '—',
      };
    }
    return {
      active,
      inviters: summary.totalInviters,
      invitees: summary.totalInvitees,
      conversion: `${(summary.conversionRate * 100).toFixed(1)}%`,
      completed: summary.totalRedemptions,
    };
  }, [programs, summary]);

  const programLabel = (id: string) =>
    programs.find((p) => p.id === id)?.name ?? id;

  const programConditionLabel = (id: string) => {
    const condition = programs.find((p) => p.id === id)?.rewardCondition;
    return condition ? REWARD_CONDITION_LABEL[condition] : '—';
  };

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (row: ReferralProgram) => {
    setEditing(row);
    setModalOpen(true);
  };

  // Modal 带 destroyOnClose,表单在打开时才挂载;必须等挂载后再填值,
  // 否则 setFieldsValue 打在未连接的 form 上会被丢弃(编辑打开时不回显)。
  useEffect(() => {
    if (!modalOpen) return;
    form.resetFields();
    if (editing) {
      form.setFieldsValue({
        name: editing.name,
        rewardCondition: editing.rewardCondition,
        productId: editing.productId,
        range:
          editing.startAt && editing.endAt
            ? [dayjs(editing.startAt), dayjs(editing.endAt)]
            : undefined,
        sameIpLimit: editing.sameIpLimit,
        sameDeviceLimit: editing.sameDeviceLimit,
        perUserInviteLimit: editing.perUserInviteLimit,
        isActive: editing.isActive,
      });
    } else {
      form.setFieldsValue({
        rewardCondition: 'REGISTER',
        isActive: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, editing]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const body: Partial<ReferralProgram> = {
        name: values.name,
        inviterReward: 0,
        inviteeReward: 0,
        rewardCondition: values.rewardCondition,
        productId: values.productId,
        trackingOnly: true,
        // 生效时间按整日计:开始取当日 00:00:00,结束取当日 23:59:59
        startAt: values.range
          ? values.range[0].startOf('day').toISOString()
          : undefined,
        endAt: values.range
          ? values.range[1].endOf('day').toISOString()
          : undefined,
        sameIpLimit: values.sameIpLimit,
        sameDeviceLimit: values.sameDeviceLimit,
        perUserInviteLimit: values.perUserInviteLimit,
        isActive: values.isActive,
      };
      if (editing) {
        await referralApi.updateProgram(editing.id, body);
        message.success('已更新');
      } else {
        await referralApi.createProgram(body);
        message.success('已创建');
      }
      setModalOpen(false);
      await Promise.all([fetchPrograms(), fetchSummary()]);
    } catch (err: unknown) {
      if ((err as { errorFields?: unknown })?.errorFields) return;
      message.error('保存失败');
    }
  };

  const handleDelete = async (row: ReferralProgram) => {
    try {
      await referralApi.deleteProgram(row.id);
      message.success('已删除');
      await Promise.all([fetchPrograms(), fetchSummary()]);
    } catch {
      message.error('删除失败');
    }
  };

  const handleToggle = async (row: ReferralProgram, val: boolean) => {
    try {
      await referralApi.updateProgram(row.id, { isActive: val });
      message.success(val ? '已启用' : '已停用');
      await Promise.all([fetchPrograms(), fetchSummary()]);
    } catch {
      message.error('操作失败');
    }
  };

  const loadExistingCodes = async (programId: string) => {
    const requestId = existingCodesRequestRef.current + 1;
    existingCodesRequestRef.current = requestId;
    try {
      const res = await referralApi.listCodes(programId);
      if (requestId !== existingCodesRequestRef.current) return;
      setExistingCodes(res.items || []);
    } catch (error: unknown) {
      warnNonCritical('Referrals list codes', error);
      if (requestId === existingCodesRequestRef.current) setExistingCodes([]);
    }
  };

  const openLinkBuilder = (row: ReferralProgram) => {
    linkProgramIdRef.current = row.id;
    existingCodesRequestRef.current += 1;
    setLinkProgram(row);
    setGeneratedCode('');
    setGeneratedLink('');
    setGenerationStatus('');
    setGenerationError('');
    setExistingCodes([]);
    linkForm.resetFields();
    // 不默认填 utm_campaign:归因只认 ref 码,campaign 是可选的营销分析维度,
    // 默认带程序名会让链接变长并暴露内部活动名,需要时管理员自行填写。
    linkForm.setFieldsValue({
      landingUrl: defaultLandingUrl(),
      utmMedium: 'partner',
    });
    setLinkModalOpen(true);
    void loadExistingCodes(row.id); // 回显该程序已生成的邀请码
  };

  const closeLinkBuilder = () => {
    linkProgramIdRef.current = null;
    existingCodesRequestRef.current += 1;
    setLinkModalOpen(false);
  };

  const handleGenerateLink = async () => {
    if (!linkProgram) return;
    if (pendingGenerationRef.current) {
      message.warning('上一次生成请求仍在处理中，请勿重复提交');
      return;
    }
    let generationRequest: Promise<{ code: string }> | null = null;
    let generationTimedOut = false;
    try {
      const values = await linkForm.validateFields();
      setGeneratedCode('');
      setGeneratedLink('');
      setGenerationError('');
      setGenerationStatus('正在生成推广链接...');
      setLinkGenerating(true);
      message.loading({ key: 'referral-link-generate', content: '正在生成推广链接...', duration: 0 });
      const requestId = generationRequestRef.current + 1;
      generationRequestRef.current = requestId;
      const programId = linkProgram.id;
      const request = referralApi.generateCode(programId, {
        inviterUser: values.inviterUser.trim(),
      });
      generationRequest = request;
      pendingGenerationRef.current = request;
      const result = await Promise.race([request, timeoutAfter(12_000)]);
      if (result === 'timeout') {
        generationTimedOut = true;
        setGenerationStatus('请求仍在处理中，完成后会自动显示结果');
        setGenerationError('请求超时，请勿重复提交；系统正在等待后端结果。');
        message.warning({
          key: 'referral-link-generate',
          content: '请求超时，仍在等待后端结果，请勿重复提交',
        });
        void request
          .then((resolved) => {
            if (generationRequestRef.current !== requestId || linkProgramIdRef.current !== programId) return;
            const link = buildPromotionLink(values, resolved.code);
            setGeneratedCode(resolved.code);
            setGeneratedLink(link);
            setGenerationStatus('推广链接已生成，可以复制给推广方');
            setGenerationError('');
            message.success({ key: 'referral-link-generate', content: '推广链接已生成' });
            void loadExistingCodes(programId);
          })
          .catch((error: unknown) => {
            if (generationRequestRef.current !== requestId || linkProgramIdRef.current !== programId) return;
            const text = apiErrorMessage(error, '生成推广链接失败');
            setGenerationStatus('');
            setGenerationError(text);
            message.error({ key: 'referral-link-generate', content: text });
          })
          .finally(() => {
            if (pendingGenerationRef.current === request) pendingGenerationRef.current = null;
          });
        return;
      }
      const link = buildPromotionLink(values, result.code);
      setGeneratedCode(result.code);
      setGeneratedLink(link);
      setGenerationStatus('推广链接已生成，可以复制给推广方');
      message.success({ key: 'referral-link-generate', content: '推广链接已生成' });
      void loadExistingCodes(programId); // 刷新已生成码列表

    } catch (err: unknown) {
      if ((err as { errorFields?: unknown })?.errorFields) {
        setGenerationStatus('');
        setGenerationError('请先填写推广方用户和落地页 URL');
        message.warning('请先填写推广方用户和落地页 URL');
        return;
      }
      const text = apiErrorMessage(err, '生成推广链接失败');
      setGenerationStatus('');
      setGenerationError(text);
      message.error({ key: 'referral-link-generate', content: text });
    } finally {
      setLinkGenerating(false);
      if (!generationTimedOut && generationRequest && pendingGenerationRef.current === generationRequest) {
        pendingGenerationRef.current = null;
      }
    }
  };

  const handleCopyPromotionLink = async () => {
    if (!generatedLink) return;
    const ok = await copyText(generatedLink);
    if (ok) message.success('已复制推广链接');
    else message.error('复制失败,请手动选中链接复制');
  };

  // 复制某已生成码的完整推广链接(用当前表单的落地页/UTM 拼接)
  const handleCopyExistingCode = async (code: string) => {
    try {
      const values = linkForm.getFieldsValue();
      const link = buildPromotionLink(
        { ...values, landingUrl: values.landingUrl || defaultLandingUrl() },
        code,
      );
      const ok = await copyText(link);
      if (ok) message.success('已复制推广链接');
      else message.error('复制失败,请手动复制');
    } catch {
      message.error('落地页 URL 无效，请先修正后再复制');
    }
  };

  const programColumns = [
    {
      title: '程序名',
      dataIndex: 'name',
      key: 'name',
      render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span>,
    },
    {
      title: '触发条件',
      dataIndex: 'rewardCondition',
      key: 'rewardCondition',
      width: 130,
      render: (v: ReferralProgram['rewardCondition']) => (
        <Tag>{REWARD_CONDITION_LABEL[v] ?? v}</Tag>
      ),
    },
    {
      title: '启用',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 80,
      render: (v: boolean, r: ReferralProgram) => (
        <Switch checked={v} size="small" disabled={!canManage} onChange={(b) => handleToggle(r, b)} />
      ),
    },
    {
      title: '达成数',
      key: 'redemptions',
      width: 110,
      render: (_: unknown, r: ReferralProgram) => {
        const count = summary?.perProgram[r.id]?.redemptionCount;
        return count == null ? (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        ) : (
          count
        );
      },
    },
    {
      title: '点击数',
      key: 'clickUv',
      width: 100,
      render: (_: unknown, r: ReferralProgram) => {
        const uv = summary?.perProgram[r.id]?.clickUv;
        return uv == null ? (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        ) : (
          uv
        );
      },
    },
    {
      title: '点击达成率',
      key: 'clickConversion',
      width: 110,
      render: (_: unknown, r: ReferralProgram) => {
        const agg = summary?.perProgram[r.id];
        if (!agg || !agg.clickUv) {
          return <span style={{ color: 'var(--text-muted)' }}>—</span>;
        }
        return `${((agg.redemptionCount / agg.clickUv) * 100).toFixed(1)}%`;
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 240,
      align: 'right' as const,
      render: (_: unknown, r: ReferralProgram) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            icon={<LinkOutlined />}
            disabled={!canManage}
            onClick={() => openLinkBuilder(r)}
          >
            生成链接
          </Button>
          <Button type="link" size="small" disabled={!canManage} onClick={() => openEdit(r)}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除此邀请程序？"
            onConfirm={() => handleDelete(r)}
          >
            <Button type="link" size="small" danger disabled={!canManage}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const invitationColumns = [
    {
      title: '程序',
      dataIndex: 'programId',
      key: 'programId',
      render: (id: string) => programLabel(id),
    },
    {
      title: '触发条件',
      dataIndex: 'programId',
      key: 'condition',
      width: 120,
      render: (id: string) => <Tag>{programConditionLabel(id)}</Tag>,
    },
    {
      title: '邀请人',
      dataIndex: 'inviterUserId',
      key: 'inviterUserId',
      render: (v: string, r: ReferralRedemption) => renderUserCell(v, r.inviter),
    },
    {
      title: '被邀请人',
      dataIndex: 'inviteeUserId',
      key: 'inviteeUserId',
      render: (v: string, r: ReferralRedemption) => renderUserCell(v, r.invitee),
    },
    {
      title: '注册时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '当前状态',
      key: 'progress',
      width: 160,
      render: (_: unknown, r: ReferralRedemption) => {
        if (r.rejectReason) {
          return (
            <span title={r.rejectReason}>
              <Tag variant="error">已拒绝</Tag>
            </span>
          );
        }
        const condition = programs.find((p) => p.id === r.programId)?.rewardCondition;
        const completed = Boolean(r.triggeredAt);
        const label =
          condition === 'REGISTER'
            ? completed
              ? '已完成注册'
              : '注册未完成'
            : condition === 'FIRST_RECHARGE'
              ? completed
                ? '已完成首次充值'
                : '待首次充值'
              : condition === 'FIRST_SUBSCRIBE'
                ? completed
                  ? '已完成首次订阅'
                  : '待首次订阅'
                : completed
                  ? '条件已达成'
                  : '条件未达成';
        return <Tag variant={completed ? 'success' : 'warn'}>{label}</Tag>;
      },
    },
    {
      title: '完成时间',
      dataIndex: 'triggeredAt',
      key: 'triggeredAt',
      width: 170,
      render: (v: string | null) =>
        v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—',
    },
    {
      title: '地区',
      key: 'geo',
      width: 140,
      render: (_: unknown, r: ReferralRedemption) =>
        [r.country, r.city].filter(Boolean).join(' / ') || '—',
    },
    {
      title: '来源',
      dataIndex: 'referrer',
      key: 'referrer',
      width: 180,
      render: (v?: string | null) => v || 'direct',
    },
    {
      title: 'UTM Source',
      dataIndex: 'utmSource',
      key: 'utmSource',
      width: 130,
      render: (v?: string | null) => v || '—',
    },
  ];

  const leaderboardColumns = [
    {
      title: '排名',
      key: 'rank',
      width: 80,
      render: (_: unknown, __: LeaderboardRow, i: number) => `#${i + 1}`,
    },
    {
      title: '邀请人',
      dataIndex: 'userId',
      key: 'userId',
    },
    {
      title: '邮箱 / 手机号',
      key: 'contact',
      render: (_: unknown, r: LeaderboardRow) => {
        const nick =
          r.nickname && r.nickname !== r.email && r.nickname !== r.phone
            ? r.nickname
            : null;
        return [r.email, r.phone, nick].filter(Boolean).join(' / ') || '—';
      },
    },
    {
      title: '条件达成数',
      dataIndex: 'inviteCount',
      key: 'inviteCount',
      width: 100,
    },
  ];

  // 排行榜展开行:某邀请人邀请到的被邀请人明细
  const inviteeColumns = [
    {
      title: '被邀请人',
      dataIndex: 'inviteeUserId',
      key: 'inviteeUserId',
      render: (v: string, r: ReferralRedemption) => renderUserCell(v, r.invitee),
    },
    {
      title: '地区',
      key: 'geo',
      width: 140,
      render: (_: unknown, r: ReferralRedemption) =>
        [r.country, r.city].filter(Boolean).join(' / ') || '—',
    },
    {
      title: '来源',
      dataIndex: 'referrer',
      key: 'referrer',
      width: 180,
      render: (v?: string | null) => v || 'direct',
    },
    {
      title: '完成时间',
      dataIndex: 'triggeredAt',
      key: 'triggeredAt',
      width: 170,
      render: (v?: string | null) =>
        v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—',
    },
  ];

  return (
    <div>
      <PageHeader
        title="邀请裂变"
        subtitle="管理邀请程序，查看邀请进度与排行榜"
        actions={[
          <Button
            key="refresh"
            icon={<ReloadOutlined />}
            loading={refreshing}
            onClick={handleRefresh}
          >
            刷新
          </Button>,
          ...(stubMode || !canManage
            ? []
            : [
                <Button
                  key="new"
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={openCreate}
                >
                  新建邀请程序
                </Button>,
              ]),
        ]}
      />

      <StatCardGroup columns={5}>
        <StatCard label="活跃程序" value={stats.active} />
        <StatCard label="总邀请人" value={stats.inviters} />
        <StatCard label="总被邀请人" value={stats.invitees} />
        <StatCard label="条件达成率" value={stats.conversion} />
        <StatCard label="条件达成数" value={stats.completed} />
      </StatCardGroup>

      {stubMode ? (
        <EmptyPlaceholder
          title="后端接口待就绪"
          description="邀请裂变接口尚未上线。"
          todos={[
            'ReferralProgram + ReferralRedemption 表',
            'leaderboard 防作弊聚合',
          ]}
        />
      ) : (
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'programs',
              label: '程序列表',
              children:
                programs.length === 0 && !loading ? (
                  <EmptyPlaceholder
                    title="暂无邀请程序"
                    description="尚未创建任何邀请程序。"
                  />
                ) : (
                  <DataTable<ReferralProgram>
                    columns={programColumns}
                    dataSource={programs}
                    rowKey="id"
                    searchable
                    searchPlaceholder="搜索邀请程序 / 触发条件"
                    loading={loading}
                    pagination={{ pageSize: 20 }}
                    scroll={{ x: 900 }}
                    expandable={{
                      onExpand: (expanded, r) => {
                        if (expanded) loadClickSources(r.id);
                      },
                      expandedRowRender: (r) => {
                        const src = clickSources[r.id];
                        if (clickSourcesLoading[r.id] && !src) {
                          return (
                            <div style={{ padding: 12 }}>
                              <Spin size="small" /> 加载点击来源…
                            </div>
                          );
                        }
                        if (
                          !src ||
                          (src.byReferrer.length === 0 &&
                            src.byUtmSource.length === 0)
                        ) {
                          return (
                            <EmptyPlaceholder
                              title="暂无点击来源"
                              description="该程序尚无链接点击记录。"
                            />
                          );
                        }
                        return (
                          <div
                            style={{
                              display: 'flex',
                              gap: 24,
                              flexWrap: 'wrap',
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 320 }}>
                              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                                来源页面(referrer)
                              </div>
                              <DataTable<ClickSourceRow>
                                columns={clickSourceColumns('来源页面')}
                                dataSource={src.byReferrer}
                                rowKey="source"
                                pagination={false}
                              />
                            </div>
                            <div style={{ flex: 1, minWidth: 320 }}>
                              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                                投放渠道(utm_source)
                              </div>
                              <DataTable<ClickSourceRow>
                                columns={clickSourceColumns('渠道')}
                                dataSource={src.byUtmSource}
                                rowKey="source"
                                pagination={false}
                              />
                            </div>
                          </div>
                        );
                      },
                    }}
                  />
                ),
            },
            {
              key: 'redemptions',
              label: '邀请记录',
              children:
                redemptions.length === 0 && redempTotal === 0 && !redemptionsLoading ? (
                  <EmptyPlaceholder
                    title="暂无邀请记录"
                    description="当前还没有通过邀请链接注册的用户。"
                  />
                ) : (
                  <DataTable<ReferralRedemption>
                    columns={invitationColumns}
                    dataSource={redemptions}
                    rowKey="id"
                    loading={redemptionsLoading}
                    scroll={{ x: 1500 }}
                    listPagination={{
                      current: redempPage,
                      total: redempTotal,
                      pageSize: 20,
                      onChange: setRedempPage,
                    }}
                  />
                ),
            },
            {
              key: 'leaderboard',
              label: '排行榜',
              children:
                leaderboard.length === 0 ? (
                  <EmptyPlaceholder
                    title="暂无排行榜数据"
                    description="可能尚未有用户邀请或聚合任务未运行。"
                  />
                ) : (
                  <DataTable<LeaderboardRow>
                    columns={leaderboardColumns}
                    dataSource={[...leaderboard]
                      .sort((a, b) => b.inviteCount - a.inviteCount)
                      .slice(0, 50)}
                    rowKey="userId"
                    pagination={false}
                    expandable={{
                      onExpand: (expanded, row) => {
                        if (expanded) loadInvitees(row.userId);
                      },
                      expandedRowRender: (row) => {
                        const rows = inviteeDetails[row.userId];
                        if (inviteeLoading[row.userId] && !rows) {
                          return (
                            <div style={{ padding: 12 }}>
                              <Spin size="small" /> 加载被邀请人…
                            </div>
                          );
                        }
                        if (!rows || rows.length === 0) {
                          return (
                            <EmptyPlaceholder
                              title="暂无被邀请人"
                              description="该邀请人名下暂无已达成条件的邀请记录。"
                            />
                          );
                        }
                        return (
                          <DataTable<ReferralRedemption>
                            columns={inviteeColumns}
                            dataSource={rows}
                            rowKey="id"
                            pagination={false}
                          />
                        );
                      },
                    }}
                  />
                ),
            },
          ]}
        />
      )}

      <Modal
        open={modalOpen}
        title={editing ? '编辑邀请程序' : '新建邀请程序'}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        okButtonProps={{ disabled: !canManage }}
        destroyOnClose
        width={640}
      >
        <Form form={form} layout="vertical" disabled={!canManage}>
          <Form.Item
            label="程序名"
            name="name"
            rules={[{ required: true, message: '必填' }]}
          >
            <Input placeholder="春季邀请有礼" />
          </Form.Item>
          <Form.Item
            label="触发条件"
            name="rewardCondition"
            rules={[{ required: true }]}
          >
            <Select
              options={Object.entries(REWARD_CONDITION_LABEL).map(([v, l]) => ({
                value: v,
                label: l,
              }))}
            />
          </Form.Item>
          <Form.Item label="适用产品（可选）" name="productId">
            <Select
              allowClear
              placeholder="不选则全产品"
              options={products.map((p) => ({ label: p.name, value: p.id }))}
            />
          </Form.Item>
          <Form.Item label="生效时间（可选）" name="range">
            <DatePicker.RangePicker style={{ width: '100%' }} />
          </Form.Item>
          <Space size="large">
            <Form.Item
              label="同 IP 限"
              name="sameIpLimit"
              tooltip="同一 IP 最多邀请数"
            >
              <StableNumberInput min={0} precision={0} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item
              label="同设备限"
              name="sameDeviceLimit"
              tooltip="同一设备最多邀请数"
            >
              <StableNumberInput min={0} precision={0} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item
              label="每人邀请上限"
              name="perUserInviteLimit"
              tooltip="单个用户最多能邀请多少人"
            >
              <StableNumberInput min={0} precision={0} style={{ width: 120 }} />
            </Form.Item>
          </Space>
          <Form.Item label="启用" name="isActive" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={linkModalOpen}
        title={linkProgram ? `生成推广链接：${linkProgram.name}` : '生成推广链接'}
        onCancel={closeLinkBuilder}
        footer={[
          <Button key="close" onClick={closeLinkBuilder}>
            关闭
          </Button>,
        ]}
        destroyOnClose
        width={720}
      >
        <Form form={linkForm} layout="vertical">
          <Form.Item
            label="推广方邮箱或用户 ID"
            name="inviterUser"
            rules={[
              {
                required: true,
                whitespace: true,
                message: '请输入推广方邮箱或用户 ID',
              },
            ]}
          >
            <Input placeholder="例如 partner@example.com 或 user_xxx" />
          </Form.Item>
          <Form.Item
            label="落地页 URL"
            name="landingUrl"
            rules={[
              { required: true, whitespace: true, message: '请输入落地页 URL' },
              {
                validator: (_, value?: string) => {
                  // 空值交给上面的 required 规则报错,这里只校验格式,避免重复提示
                  if (!value?.trim()) return Promise.resolve();
                  try {
                    new URL(value.trim(), window.location.origin);
                    return Promise.resolve();
                  } catch {
                    return Promise.reject(new Error('落地页 URL 不合法'));
                  }
                },
              },
            ]}
          >
            <Input placeholder="https://example.com/register" />
          </Form.Item>
          <Space size="large" wrap>
            <Form.Item label="UTM Source" name="utmSource">
              <Input placeholder="zhipu" style={{ width: 160 }} />
            </Form.Item>
            <Form.Item label="UTM Medium" name="utmMedium">
              <Input placeholder="partner" style={{ width: 160 }} />
            </Form.Item>
            <Form.Item label="UTM Campaign" name="utmCampaign">
              <Input placeholder="zhipu_2026" style={{ width: 180 }} />
            </Form.Item>
            <Form.Item label="UTM Content" name="utmContent">
              <Input placeholder="banner_a" style={{ width: 160 }} />
            </Form.Item>
          </Space>
          {generatedCode ? (
            <Form.Item label="邀请码">
              <Typography.Text code copyable>
                {generatedCode}
              </Typography.Text>
            </Form.Item>
          ) : null}
          <Form.Item label="推广链接">
            <Input.TextArea
              value={generatedLink}
              readOnly
              autoSize={{ minRows: 2, maxRows: 4 }}
              placeholder="点击生成后展示完整推广链接"
            />
          </Form.Item>
          {generationStatus ? (
            <Typography.Text type="secondary">{generationStatus}</Typography.Text>
          ) : null}
          {generationError ? (
            <Typography.Text type="danger">{generationError}</Typography.Text>
          ) : null}
          <div style={{ marginTop: 12 }}>
            <Space>
              <Button
                type="primary"
                icon={<LinkOutlined />}
                loading={linkGenerating}
                onClick={handleGenerateLink}
              >
                生成链接
              </Button>
              <Button
                icon={<CopyOutlined />}
                disabled={!generatedLink}
                onClick={handleCopyPromotionLink}
              >
                复制此链接
              </Button>
            </Space>
          </div>
          {existingCodes.length > 0 ? (
            <Form.Item
              label="已生成的推广码"
              style={{ marginTop: 16 }}
              tooltip="该程序已为这些推广方生成过邀请码;复制链接用上方当前落地页/UTM 拼接"
            >
              <DataTable<ReferralCodeRow>
                columns={[
                  {
                    title: '推广方',
                    key: 'inviter',
                    render: (_: unknown, r: ReferralCodeRow) =>
                      renderUserCell(r.inviterUserId, r.inviter),
                  },
                  {
                    title: '邀请码',
                    dataIndex: 'code',
                    key: 'code',
                    width: 120,
                    render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
                  },
                  {
                    title: '操作',
                    key: 'op',
                    width: 100,
                    render: (_: unknown, r: ReferralCodeRow) => (
                      <Button
                        type="link"
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={() => handleCopyExistingCode(r.code)}
                      >
                        复制链接
                      </Button>
                    ),
                  },
                ]}
                dataSource={existingCodes}
                rowKey="code"
                pagination={false}
              />
            </Form.Item>
          ) : null}
        </Form>
      </Modal>
    </div>
  );
}
