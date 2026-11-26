import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());

vi.mock('../axios', () => ({
  default: { get },
}));

import { enterpriseAccountV2Api } from './enterpriseAccountsV2';

describe('enterpriseAccountV2Api.download', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('refreshes the session and starts the download in a frame that stays on the page', async () => {
    const order: string[] = [];
    get.mockImplementation(async () => {
      order.push('profile');
      return { data: {} };
    });
    let clicked: HTMLAnchorElement | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      order.push('click');
      clicked = this;
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await enterpriseAccountV2Api.download('ba-1', '2026-08', '2026-08-示例-企业账单.xlsx');

    const iframe = document.body.querySelector('iframe');
    expect(order).toEqual(['profile', 'click']);
    expect(get).toHaveBeenCalledWith('/admin/auth/profile');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(iframe).not.toBeNull();
    expect(iframe!.hidden).toBe(true);
    expect(clicked).not.toBeNull();
    expect(clicked!.target).toBe(iframe!.name);
    expect(clicked!.getAttribute('href')).toBe(
      '/api/admin/v2/enterprise-accounts/ba-1/bills/2026-08/download',
    );
    expect(clicked!.download).toBe('2026-08-示例-企业账单.xlsx');
    expect(document.body.querySelector('a')).toBeNull();
    expect(document.body.querySelector('iframe')).toBe(iframe);
  });

  it('starts the download when randomUUID is unavailable on http', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
      throw new TypeError('crypto.randomUUID is not a function');
    });

    await enterpriseAccountV2Api.download('ba-1', '2026-08', '账单.xlsx');

    const iframe = document.body.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe!.name).toMatch(/^enterprise-bill-download-/);
  });

  it('does not open a download frame when the session refresh fails', async () => {
    get.mockImplementation(async () => {
      throw new Error('未登录');
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');

    await expect(
      enterpriseAccountV2Api.download('ba-1', '2026-08', '账单.xlsx'),
    ).rejects.toThrow('未登录');
    expect(click).not.toHaveBeenCalled();
    expect(document.body.querySelector('iframe')).toBeNull();
  });
});
