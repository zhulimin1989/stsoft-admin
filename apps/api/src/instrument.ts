/**
 * Sentry bootstrap — MUST be the first import in main.ts.
 *
 * @sentry/nestjs 10.x is built on OpenTelemetry. Instrumentation is set up
 * by monkey-patching Node's require cache, which only works if this file
 * runs before any HTTP/DB/queue client is imported. Put it at the top.
 *
 * Behavior matrix:
 *   SENTRY_DSN unset            → init() is skipped, Sentry becomes a no-op.
 *   SENTRY_DSN set + dev        → DSN active, verbose debug, 100% sample.
 *   SENTRY_DSN set + production → DSN active, 10% trace/profile sample.
 *   SENTRY_DSN unset in prod    → assertProductionSecrets surfaces it.
 */

import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { isProductionEnv } from './common/runtime/is-production';
import { isEnterpriseAdminUrl, enterpriseAdminTelemetryPath } from './common/telemetry/enterprise-admin-telemetry';

export interface InstrumentOptions {
  env?: NodeJS.ProcessEnv;
  initFn?: typeof Sentry.init;
}

export function buildSentryOptions(env: NodeJS.ProcessEnv): Parameters<typeof Sentry.init>[0] | null {
  const dsn = env.SENTRY_DSN;
  if (!dsn) return null;

  const isProd = isProductionEnv(env);

  return {
    dsn,
    environment: env.NODE_ENV ?? 'development',
    release: env.SENTRY_RELEASE ?? env.GIT_COMMIT_SHA,

    // Trace sampling: 10% in prod keeps cost bounded while still catching
    // slow-request patterns. In non-prod we trace everything for debugging.
    tracesSampleRate: isProd ? 0.1 : 1.0,

    // CPU/heap profiling on the same budget as traces. Expensive enough
    // that we never sample more than the trace rate.
    profileSessionSampleRate: isProd ? 0.1 : 1.0,
    profileLifecycle: 'trace',

    integrations: [nodeProfilingIntegration()],

    // Don't ship 4xx as issues — they're client errors, not bugs.
    // Keep unexpected 4xx from auth/rate-limit by not filtering 401/403/429.
    beforeSend(event, hint) {
      if (event.request?.url && isEnterpriseAdminUrl(event.request.url)) {
        event.request = { url: enterpriseAdminTelemetryPath(event.request.url), method: event.request.method };
        event.transaction = `${event.request.method ?? 'HTTP'} ${event.request.url}`; event.user = undefined; event.breadcrumbs = []; event.extra = {};
        for (const value of event.exception?.values ?? []) { value.value = 'enterprise_admin_proxy_failure'; for (const frame of value.stacktrace?.frames ?? []) delete frame.vars; }
      }
      const status =
        (event.contexts?.response as { status_code?: number } | undefined)?.status_code ??
        (hint?.originalException as { status?: number } | undefined)?.status;
      if (status && status >= 400 && status < 500) {
        const noisy4xx = [400, 404, 422];
        if (noisy4xx.includes(status)) return null;
      }
      return event;
    },
    beforeSendTransaction(event) {
      if (event.request?.url && isEnterpriseAdminUrl(event.request.url)) {
        event.request = { url: enterpriseAdminTelemetryPath(event.request.url), method: event.request.method };
        event.transaction = `${event.request.method ?? 'HTTP'} ${event.request.url}`; event.user = undefined; event.breadcrumbs = []; event.extra = {};
        event.spans = event.spans?.map(span => ({ ...span, description: span.op, data: {} }));
      }
      return event;
    },

    // Prevent Sentry itself from capturing events it generates
    // while trying to capture something else (infinite loop guard).
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'Non-Error promise rejection captured',
    ],
  };
}

export function initSentry(opts: InstrumentOptions = {}): boolean {
  const env = opts.env ?? process.env;
  const options = buildSentryOptions(env);
  if (!options) return false;
  const initFn = opts.initFn ?? Sentry.init;
  initFn(options);
  return true;
}

// Eager side effect — triggers when main.ts imports this module.
initSentry();
