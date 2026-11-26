import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

let refreshPromise: Promise<boolean> | null = null;
let lastRefreshOkAt = 0;
const REFRESH_GRACE_MS = 5000;

function shouldLogRefreshFailure(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return true;
  const status = error.response?.status;
  return status !== 401 && status !== 403;
}

function doRefresh(): Promise<boolean> {
  return axios.post('/api/admin/auth/refresh', {}, { withCredentials: true })
    .then(() => { lastRefreshOkAt = Date.now(); return true; })
    .catch((error: unknown) => {
      if (shouldLogRefreshFailure(error)) {
        console.warn('[admin-auth] session refresh failed', error);
      }
      return false;
    });
}

/**
 * 把后端返回的 message 提到 error.message 上。
 *
 * 为什么要在拦截器做:全站的错误提示都是 `message.error((err as Error)?.message || '兜底文案')`,
 * 而 axios 自己的 Error.message 恒为 "Request failed with status code 4xx",
 * 于是后端精心写的原因(例如「启用正信用额度时 termsDays 必须为正整数」)一律看不到,
 * 用户只能看到一个没有正文的 400。2026-09-03 上海 UAT 配置企业信用额度就是这样:
 * 页面只显示 "Request failed with status code 400",要翻服务端日志 + 读源码才知道缺了账期天数。
 *
 * 在这里统一提取,所有调用方不需要改动,兜底文案也仍然生效(提不到时不动 error.message)。
 *
 * 取值顺序按「越具体越优先」:
 *   data.message -> data.error.message -> data.error -> data.detail
 * 只接受非空字符串;数组(class-validator 的多条校验)join 成一行。
 */
function extractServerMessage(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null;
  const data = error.response?.data as
    | { message?: unknown; error?: unknown; detail?: unknown }
    | undefined;
  if (!data || typeof data !== 'object') return null;
  const candidates: unknown[] = [
    data.message,
    typeof data.error === 'object' && data.error !== null
      ? (data.error as { message?: unknown }).message
      : undefined,
    data.error,
    data.detail,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate;
    // class-validator 的 message 是 string[];合成一行,避免只显示第一条。
    if (Array.isArray(candidate)) {
      const joined = candidate.filter((x) => typeof x === 'string' && x.trim() !== '').join('；');
      if (joined !== '') return joined;
    }
  }
  return null;
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    // 先补 message,再走 401 重试逻辑:重试成功的请求不会走到这里,
    // 重试失败的最终 reject 也应带上服务端原因。
    const serverMessage = extractServerMessage(error);
    if (serverMessage && error instanceof Error) {
      error.message = serverMessage;
    }
    const originalRequest = error.config;
    if (!originalRequest || error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }
    // 登录和刷新请求的 401 不做拦截，直接抛给调用方
    const url = originalRequest.url || '';
    if (url.includes('/auth/login') || url.includes('/auth/refresh')) {
      return Promise.reject(error);
    }
    originalRequest._retry = true;

    // 刚刚 refresh 成功过，直接重试（处理迟到的 401）
    if (Date.now() - lastRefreshOkAt < REFRESH_GRACE_MS) {
      return api.request(originalRequest);
    }

    if (!refreshPromise) {
      refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
    }

    const ok = await refreshPromise;
    if (ok) {
      return api.request(originalRequest);
    }

    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export default api;
