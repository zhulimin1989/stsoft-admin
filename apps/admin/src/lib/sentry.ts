import * as Sentry from '@sentry/react';
import { sanitizeEnterpriseUiTelemetry } from './enterprise-admin-telemetry';

/**
 * Admin frontend Sentry bootstrap. Called once from main.tsx before React renders.
 *
 * Behavior:
 *   VITE_SENTRY_DSN unset → Sentry is a no-op. Useful for local dev.
 *   VITE_SENTRY_DSN set   → errors + performance sampled into the 'admin' project.
 *
 * Environment variables (from Vite):
 *   VITE_SENTRY_DSN      — project DSN (required for enablement)
 *   VITE_APP_ENV         — 'production' | 'staging' | 'development'
 *   VITE_GIT_COMMIT_SHA  — injected by CI, links events to source
 */
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  const env = import.meta.env.VITE_APP_ENV ?? import.meta.env.MODE ?? 'development';
  const isProd = env === 'production';

  Sentry.init({
    dsn,
    environment: env,
    release: import.meta.env.VITE_GIT_COMMIT_SHA,
    beforeSend: event=>sanitizeEnterpriseUiTelemetry(event,window.location.pathname),
    beforeSendTransaction: event=>sanitizeEnterpriseUiTelemetry(event,window.location.pathname),

    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        // Redact UI text/input by default — admin handles PII (email, phone, etc).
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
      }),
    ],

    // Performance tracing — 10% in prod keeps volume bounded.
    tracesSampleRate: isProd ? 0.1 : 1.0,

    // Session replay — capture 10% of sessions plus 100% of sessions that error.
    replaysSessionSampleRate: isProd ? 0.1 : 0,
    replaysOnErrorSampleRate: 1.0,

    // Tag every event so a single Sentry project can host both apps later
    // if the team decides to consolidate.
    initialScope: { tags: { app: 'admin' } },

    // Drop pure network errors that aren't actionable.
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'Non-Error promise rejection captured',
      'NetworkError when attempting to fetch resource.',
      'Failed to fetch',
    ],
  });
}

// Re-export so main.tsx can wrap the root with the Sentry-enhanced boundary.
export const SentryErrorBoundary = Sentry.ErrorBoundary;
export { Sentry };
