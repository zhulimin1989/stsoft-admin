import { afterEach, describe, expect, it, vi } from 'vitest';

interface AdminUser {
  id: string;
  email: string;
  nickname: string;
  resolvedPermissions?: string[];
}

function adminUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 'admin-1',
    email: 'admin@example.com',
    nickname: 'Admin',
    resolvedPermissions: ['admin.dashboard'],
    ...overrides,
  };
}

async function loadAuthStore(options: {
  path?: string;
  profileResult?: AdminUser;
  profileError?: unknown;
} = {}) {
  vi.resetModules();
  window.history.pushState({}, '', options.path ?? '/login');
  window.__ADMIN_AUTH_STORE_BOOTSTRAP_ENABLED__ = true;

  const authApi = {
    login: vi.fn(),
    logout: vi.fn(),
    profile: vi.fn(),
  };

  if (options.profileError) {
    authApi.profile.mockRejectedValue(options.profileError);
  } else {
    authApi.profile.mockResolvedValue(options.profileResult ?? adminUser());
  }

  vi.doMock('../../api/admin', () => ({ authApi }));
  const module = await import('../auth-store');
  await Promise.resolve();
  await Promise.resolve();

  return { authApi, useAuthStore: module.useAuthStore };
}

describe('auth store', () => {
  afterEach(() => {
    delete window.__ADMIN_AUTH_STORE_BOOTSTRAP_ENABLED__;
    vi.restoreAllMocks();
    vi.doUnmock('../../api/admin');
  });

  it('skips profile bootstrap on login route', async () => {
    const { authApi, useAuthStore } = await loadAuthStore({ path: '/login' });

    expect(authApi.profile).not.toHaveBeenCalled();
    expect(useAuthStore.getState().loading).toBe(false);
  });

  it('hydrates the current user from profile bootstrap', async () => {
    const user = adminUser({ id: 'admin-2', email: 'ops@example.com' });
    const { authApi, useAuthStore } = await loadAuthStore({ path: '/', profileResult: user });

    expect(authApi.profile).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user).toEqual(user);
    expect(useAuthStore.getState().loading).toBe(false);
  });

  it('logs unexpected bootstrap failures and leaves auth unresolved', async () => {
    const error = new Error('profile unavailable');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { useAuthStore } = await loadAuthStore({ path: '/', profileError: error });

    expect(warn).toHaveBeenCalledWith('[admin-auth] profile bootstrap failed', error);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().loading).toBe(false);
  });

  it('does not warn for expected unauthorized bootstrap failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await loadAuthStore({
      path: '/',
      profileError: { isAxiosError: true, response: { status: 401 } },
    });

    expect(warn).not.toHaveBeenCalled();
  });

  it('sets user on login and clears it on logout', async () => {
    const user = adminUser({ id: 'admin-3' });
    const { authApi, useAuthStore } = await loadAuthStore({ path: '/login' });
    authApi.login.mockResolvedValue({ user });
    authApi.logout.mockResolvedValue(undefined);

    await useAuthStore.getState().login('admin@example.com', 'secret');
    expect(authApi.login).toHaveBeenCalledWith('admin@example.com', 'secret');
    expect(useAuthStore.getState().user).toEqual(user);
    expect(useAuthStore.getState().loading).toBe(false);

    await useAuthStore.getState().logout();
    expect(authApi.logout).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().loading).toBe(false);
  });
});
