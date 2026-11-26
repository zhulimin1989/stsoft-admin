/**
 * Fail-fast check run at bootstrap to prevent production deploys from
 * launching with `.env.example` placeholder strings or missing secrets.
 *
 * Dev/test environments get a warning; production exits the process so the
 * container restart loop makes the mis-config visible in logs/alerts
 * instead of silently accepting `changeme_...` values.
 */
import { isProductionEnv } from '../runtime/is-production';

export interface SecretCheck {
  name: string;
  required: boolean;
  minLength?: number;
  hexLengthBytes?: number;
}

// Strings that are obviously placeholders and should never ship to prod.
const PLACEHOLDER_NEEDLES = [
  'changeme',
  'replace_with',
  'your-32-byte',
  'test_jwt_secret',
  'test-secret',
  'your-secret',
  'REPLACE_ME',
  'CHANGEME',
];

export const PRODUCTION_SECRETS: SecretCheck[] = [
  { name: 'JWT_SECRET', required: true, minLength: 32 },
  { name: 'ADMIN_TO_BILLING_TOKEN', required: true, minLength: 32 },
  { name: 'ADMIN_TO_BILLING_CONTEXT_SECRET', required: true, minLength: 32 },
  { name: 'ADMIN_TO_USER_TOKEN', required: true, minLength: 32 },
  { name: 'ADMIN_TO_USER_CONTEXT_SECRET', required: true, minLength: 32 },
  { name: 'ADMIN_DATABASE_URL', required: true, minLength: 20 },
  { name: 'REDIS_HOST', required: true },
  { name: 'METRICS_USER', required: true, minLength: 3 },
  { name: 'METRICS_PASSWORD', required: true, minLength: 16 },
  // Sentry is optional for now. When a team commits to a provider (Sentry SaaS,
  // self-hosted GlitchTip, etc.), flip required → true so a future deploy that
  // forgets the DSN fails loudly instead of silently dropping errors.
  { name: 'SENTRY_DSN', required: false, minLength: 20 },
];

export interface AssertOutcome {
  errors: string[];
  warnings: string[];
}

export function checkProductionSecrets(
  env: NodeJS.ProcessEnv,
  checks: SecretCheck[] = PRODUCTION_SECRETS,
): AssertOutcome {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const check of checks) {
    const raw = env[check.name];
    const value = typeof raw === 'string' ? raw.trim() : raw;

    if (!value) {
      if (check.required) errors.push(`${check.name} is required but not set`);
      continue;
    }

    const lowered = value.toLowerCase();
    const placeholderHit = PLACEHOLDER_NEEDLES.find((needle) =>
      lowered.includes(needle.toLowerCase()),
    );
    if (placeholderHit) {
      errors.push(`${check.name} still contains placeholder "${placeholderHit}"`);
      continue;
    }

    if (check.hexLengthBytes) {
      const expectedChars = check.hexLengthBytes * 2;
      if (!/^[0-9a-fA-F]+$/.test(value)) {
        errors.push(`${check.name} must be hex-encoded`);
      } else if (value.length !== expectedChars) {
        errors.push(
          `${check.name} must be exactly ${expectedChars} hex chars (${check.hexLengthBytes} bytes); got ${value.length}`,
        );
      }
    }

    if (check.minLength && value.length < check.minLength) {
      errors.push(`${check.name} length ${value.length} is below minimum ${check.minLength}`);
    }
  }

  return { errors, warnings };
}

/**
 * Called once at bootstrap before Nest wires any module.
 * In production mode: an error exits with code 1. In other modes: warn and continue
 * so local dev is not blocked by a missing Stripe key etc.
 */
export function assertProductionSecrets(
  env: NodeJS.ProcessEnv = process.env,
  logger: { log: (msg: string) => void; error: (msg: string) => void } = console,
  exit: (code: number) => void = process.exit.bind(process) as (code: number) => void,
): void {
  const isProd = isProductionEnv(env);
  const { errors } = checkProductionSecrets(env);

  if (errors.length === 0) return;

  const message = [
    `[secrets] ${errors.length} problem(s) found with environment configuration:`,
    ...errors.map((e) => `  - ${e}`),
  ].join('\n');

  if (isProd) {
    logger.error(message);
    logger.error('[secrets] refusing to start with insecure configuration (production environment)');
    exit(1);
    return;
  }

  logger.log(`[secrets] WARNING (non-production, continuing):\n${message}`);
}
