#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const scanRoots = ['apps/api/src', 'apps/api/scripts'];
const allowList = new Set([
  'apps/api/src/prisma/prisma.service.ts',
  'apps/api/src/common/utils/assert-production-secrets.ts',
]);
const envFiles = ['.env.example', '.env.production.example'];
const forbiddenEnvKeys = new Set([
  'DATABASE_URL',
  'BILLING_DATABASE_URL',
  'BILLING_USAGE_KAFKA_ENABLED',
  'BILLING_USAGE_KAFKA_BROKERS',
  'BILLING_USAGE_KAFKA_TOPICS',
  'BILLING_USAGE_KAFKA_TOPIC',
  'BILLING_USAGE_KAFKA_GROUP_ID',
  'BILLING_USAGE_KAFKA_CLIENT_ID',
  'BILLING_USAGE_KAFKA_CONCURRENCY',
  'BILLING_USAGE_KAFKA_SSL',
  'BILLING_USAGE_KAFKA_USERNAME',
  'BILLING_USAGE_KAFKA_PASSWORD',
  'BILLING_USAGE_KAFKA_SASL_MECHANISM',
  'USER_DATABASE_URL',
  'PUBLISHER_BASE_URL',
  'PUBLISHER_ENABLED',
  'PUBLISHER_SYNC_WORKER_ENABLED',
  'PUBLISHER_BOOTSTRAP_ON_START',
  'KMS_HMAC_SECRET',
  'GATEWAY_KMS_HMAC_SECRET',
  'CHANNEL_SECRET_ENCRYPTION_MODE',
  'CHANNEL_KMS_KEY_ID',
  'CHANNEL_KMS_REGION',
  'CHANNEL_KMS_ENDPOINT',
  'WECHAT_APP_ID',
  'WECHAT_MCH_ID',
  'WECHAT_API_V3_KEY',
  'WECHAT_SERIAL_NO',
  'WECHAT_PRIVATE_KEY_PATH',
  'WECHAT_NOTIFY_URL',
  'ALIPAY_APP_ID',
  'ALIPAY_PRIVATE_KEY',
  'ALIPAY_ALIPAY_PUBLIC_KEY',
  'ALIPAY_NOTIFY_URL',
  'STRIPE_SECRET_KEY',
]);
const forbiddenProductionEnvKeys = new Set([
  'AUTH0_CLIENT_SECRET',
  'AUTH0_MANAGEMENT_CLIENT_SECRET',
]);

const ignoredSegments = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.turbo',
]);

const patterns = [
  {
    name: 'manual PrismaClient construction',
    regex: /\bnew\s+PrismaClient\s*\(/,
  },
  {
    name: 'manual Prisma datasource override',
    regex: /\bdatasources\s*:\s*\{/,
  },
  {
    name: 'direct split database URL access',
    regex: /\b(BILLING_DATABASE_URL|ADMIN_DATABASE_URL|USER_DATABASE_URL)\b/,
  },
];

const forbiddenPackageDeps = new Set([
  '@aws-sdk/client-kms',
  '@nestjs/bullmq',
  'alipay-sdk',
  'bullmq',
  'kafkajs',
  'stripe',
  'wechatpay-node-v3',
]);

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredSegments.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (entry.isFile() && fullPath.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

const violations = [];

for (const scanRoot of scanRoots) {
  for (const file of walk(path.join(root, scanRoot))) {
    const rel = relative(file);
    if (allowList.has(rel) || rel.endsWith('.spec.ts')) continue;

    const source = fs.readFileSync(file, 'utf8');
    const lines = source.split(/\r?\n/);
    for (const pattern of patterns) {
      for (const match of source.matchAll(new RegExp(pattern.regex, 'g'))) {
        const line = source.slice(0, match.index).split(/\r?\n/).length;
        violations.push({
          file: rel,
          line,
          pattern: pattern.name,
          text: lines[line - 1]?.trim() ?? '',
        });
      }
    }
  }
}

for (const envFile of envFiles) {
  const fullPath = path.join(root, envFile);
  if (!fs.existsSync(fullPath)) continue;
  const lines = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (
      match &&
      (forbiddenEnvKeys.has(match[1]) ||
        (envFile === '.env.production.example' && forbiddenProductionEnvKeys.has(match[1])))
    ) {
      violations.push({
        file: envFile,
        line: index + 1,
        pattern: 'forbidden admin env key',
        text: line.trim(),
      });
    }
  });
}

const apiPackagePath = path.join(root, 'apps/api/package.json');
if (fs.existsSync(apiPackagePath)) {
  const pkg = JSON.parse(fs.readFileSync(apiPackagePath, 'utf8'));
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const deps = pkg[section] || {};
    for (const name of forbiddenPackageDeps) {
      if (deps[name]) {
        violations.push({
          file: 'apps/api/package.json',
          line: 1,
          pattern: 'forbidden admin runtime dependency',
          text: `${section}.${name}`,
        });
      }
    }
  }
}

for (const forbiddenPath of [
  'apps/api/prisma/schema.prisma',
  'apps/api/prisma/migrations',
  'apps/api/prisma/seed.ts',
]) {
  if (fs.existsSync(path.join(root, forbiddenPath))) {
    violations.push({
      file: forbiddenPath,
      line: 1,
      pattern: 'forbidden legacy prisma ownership',
      text: 'admin-api must use apps/api/prisma/admin/* only',
    });
  }
}

if (violations.length > 0) {
  console.error('DB boundary check failed. Use the owning service API instead of cross-DB Prisma access.');
  for (const item of violations) {
    console.error(`- ${item.file}:${item.line} ${item.pattern}: ${item.text}`);
  }
  process.exit(1);
}

console.log('DB boundary check passed.');
