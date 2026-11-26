import { ReferralsController, enrichRedemptionContacts } from './referrals.controller';

describe('ReferralsController', () => {
  it.each([
    ['true', true],
    ['false', false],
  ])('forwards triggered=%s as %s', async (raw, parsed) => {
    const billing = {
      listReferralRedemptions: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    };
    const controller = new ReferralsController(billing as any, { getUserContactsByIds: jest.fn().mockResolvedValue({ items: [] }) } as never);

    await controller.listRedemptions({
      triggered: raw,
      page: '2',
      pageSize: '20',
    });

    expect(billing.listReferralRedemptions).toHaveBeenCalledWith({
      programId: undefined,
      inviterUserId: undefined,
      triggered: parsed,
      page: 2,
      pageSize: 20,
    });
  });
});

describe('enrichRedemptionContacts', () => {
  function row(over: Record<string, unknown> = {}) {
    return {
      inviterUserId: 'inviter-1',
      inviteeUserId: 'invitee-1',
      inviter: { email: null, phone: null, nickname: '杨彤' },
      invitee: { email: null, phone: '18298369916', nickname: '18298369916' },
      ...over,
    };
  }

  it('fills contacts only for users the mirror is missing them for', async () => {
    // billing 镜像里邀请人 phone/email 都空(nprod 实测 4 成用户如此),被邀请人有手机号。
    // 只应为邀请人发起补查 —— 已有联系方式的不该白跑一趟 user-api。
    const fetch = jest.fn().mockResolvedValue({
      items: [{ id: 'inviter-1', email: null, phone: '17631363351', nickname: '杨彤' }],
    });
    const payload = { items: [row()] };

    await enrichRedemptionContacts(payload, fetch);

    expect(fetch).toHaveBeenCalledWith(['inviter-1']);
    expect(payload.items[0].inviter).toEqual({
      email: null,
      phone: '17631363351',
      nickname: '杨彤',
    });
    // 被邀请人原样不动
    expect(payload.items[0].invitee).toEqual({
      email: null,
      phone: '18298369916',
      nickname: '18298369916',
    });
  });

  it('keeps the mirror nickname when user domain has none', async () => {
    const fetch = jest.fn().mockResolvedValue({
      items: [{ id: 'inviter-1', email: 'a@b.com', phone: null, nickname: null }],
    });
    const payload = { items: [row()] };
    await enrichRedemptionContacts(payload, fetch);
    expect(payload.items[0].inviter).toEqual({ email: 'a@b.com', phone: null, nickname: '杨彤' });
  });

  it('does not call user-api at all when nothing is missing', async () => {
    const fetch = jest.fn();
    const payload = {
      items: [row({ inviter: { email: null, phone: '13800000000', nickname: 'x' } })],
    };
    await enrichRedemptionContacts(payload, fetch);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('degrades gracefully when user-api fails — list must still render', async () => {
    const onError = jest.fn();
    const payload = { items: [row()] };
    const before = JSON.parse(JSON.stringify(payload));
    await enrichRedemptionContacts(payload, jest.fn().mockRejectedValue(new Error('boom')), onError);
    expect(payload).toEqual(before);
    expect(onError).toHaveBeenCalled();
  });

  it('treats a nickname-only contact as still missing', async () => {
    // 昵称不是联系方式 —— 列表要求先显示手机号或邮箱。
    const fetch = jest.fn().mockResolvedValue({ items: [] });
    await enrichRedemptionContacts({ items: [row()] }, fetch);
    expect(fetch).toHaveBeenCalledWith(['inviter-1']);
  });

  it('handles an empty or malformed payload without throwing', async () => {
    const fetch = jest.fn();
    await expect(enrichRedemptionContacts({ items: [] }, fetch)).resolves.toEqual({ items: [] });
    await expect(enrichRedemptionContacts(null, fetch)).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
