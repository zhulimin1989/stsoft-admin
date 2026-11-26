import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const RELOAD_MARK_KEY = 'codesphere-admin:chunk-reload-at';
const RELOAD_COOLDOWN_MS = 30_000;

export function isChunkLoadError(error: unknown): boolean {
  const text = error instanceof Error
    ? `${error.name} ${error.message} ${error.stack ?? ''}`
    : String(error ?? '');
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk \d+ failed/i
    .test(text);
}

export function reloadForFreshChunks(error: unknown): boolean {
  if (!isChunkLoadError(error) || typeof window === 'undefined') return false;

  const now = Date.now();
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_MARK_KEY) ?? '0');
    if (Number.isFinite(last) && now - last < RELOAD_COOLDOWN_MS) return false;
    window.sessionStorage.setItem(RELOAD_MARK_KEY, String(now));
  } catch {
    // Ignore storage failures; reloading once is still the safest recovery.
  }

  window.location.reload();
  return true;
}

export function lazyWithChunkReload<T extends ComponentType<unknown>>(
  loader: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() =>
    loader().catch((error: unknown) => {
      if (reloadForFreshChunks(error)) {
        return new Promise<{ default: T }>(() => {
          // Keep Suspense mounted while the browser refreshes.
        });
      }
      throw error;
    }),
  );
}

export function installChunkReloadHandlers(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('unhandledrejection', (event) => {
    if (reloadForFreshChunks(event.reason)) {
      event.preventDefault();
    }
  });

  window.addEventListener('error', (event) => {
    const error = event.error ?? event.message;
    if (reloadForFreshChunks(error)) {
      event.preventDefault();
    }
  }, true);
}
