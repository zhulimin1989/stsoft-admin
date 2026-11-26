import { AsyncLocalStorage } from 'async_hooks';

export type AdminRequestContext = {
  adminId: string;
  presetRole?: string;
  permissions?: string[];
  requestId?: string;
};

const storage = new AsyncLocalStorage<AdminRequestContext>();

export function setAdminRequestContext(context: AdminRequestContext): void {
  storage.enterWith(context);
}

export function runWithAdminRequestContext<T>(
  context: AdminRequestContext,
  callback: () => T,
): T {
  return storage.run(context, callback);
}

export function getAdminRequestContext(): AdminRequestContext | undefined {
  return storage.getStore();
}

export function clearAdminRequestContext(): void {
  storage.disable();
}
