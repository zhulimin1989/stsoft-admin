import { create } from 'zustand';
import axios from 'axios';
import { authApi } from '../api/admin';

interface User {
  id: string;
  email: string;
  nickname: string;
  role?: string;
  presetRole?: string;
  resolvedPermissions?: string[];
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

declare global {
  interface Window {
    __ADMIN_AUTH_STORE_BOOTSTRAP_ENABLED__?: boolean;
  }
}

function shouldLogProfileFailure(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return true;
  const status = error.response?.status;
  return status !== 401 && status !== 403;
}

function shouldBootstrapProfile(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.location.pathname === '/login') return false;
  return import.meta.env.MODE !== 'test' || window.__ADMIN_AUTH_STORE_BOOTSTRAP_ENABLED__ === true;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,

  login: async (email: string, password: string) => {
    const loginData = await authApi.login(email, password);
    set({ user: loginData.user, loading: false });
    return loginData.user;
  },

  logout: async () => {
    await authApi.logout();
    set({ user: null, loading: false });
  },
}));

// 应用启动时自动检查认证状态
(async () => {
  if (!shouldBootstrapProfile()) {
    useAuthStore.setState({ loading: false });
    return;
  }

  try {
    const user = await authApi.profile();
    useAuthStore.setState((state) => ({
      user: state.user ? { ...state.user, ...user } : user,
      loading: false,
    }));
  } catch (error: unknown) {
    if (shouldLogProfileFailure(error)) {
      console.warn('[admin-auth] profile bootstrap failed', error);
    }
    useAuthStore.setState((state) => ({
      user: state.user,
      loading: false,
    }));
  }
})();
