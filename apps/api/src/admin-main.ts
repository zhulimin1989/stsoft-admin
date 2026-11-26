// MUST be first: Sentry's OpenTelemetry hooks only catch modules imported
// after init(). Any reorder here silently blinds error tracking.
import './instrument';

process.env.RUIDONG_SERVICE = 'admin-api';

import type { FastifyInstance } from 'fastify';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import { VersioningType, VERSION_NEUTRAL } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { assertProductionSecrets } from './common/utils/assert-production-secrets';
import { registerSecurityPlugins } from './common/security/security.plugin';
import { registerRuntimePlaneGuard } from './common/security/runtime-plane';
import { resolveCorsOrigins } from './common/security/cors-origins';
import { RedisService } from './redis/redis.service';
import { registerEnterpriseAdminMultipart } from './enterprise-admin/enterprise-admin-http';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  assertProductionSecrets();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: true,
      bodyLimit: positiveInt(process.env.ADMIN_BODY_LIMIT_BYTES, 10 * 1024 * 1024),
      requestTimeout: 120_000,
      keepAliveTimeout: 72_000,
    }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const fastifyInstance = app.getHttpAdapter().getInstance();
  registerEnterpriseAdminMultipart(fastifyInstance, app.get(ConfigService));
  type RegisterPlugin = Parameters<typeof fastifyInstance.register>[0];
  const cookiePlugin = fastifyCookie as unknown as RegisterPlugin;
  await fastifyInstance.register(cookiePlugin, {
    secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET,
  });

  const securityFastify = fastifyInstance as unknown as FastifyInstance;
  await registerSecurityPlugins(securityFastify, {
    redis: app.get(RedisService),
  });
  await registerRuntimePlaneGuard(securityFastify, 'admin');

  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: VERSION_NEUTRAL,
    prefix: 'v',
  });

  const corsOrigins = resolveCorsOrigins({
    names: ['ADMIN_CORS_ORIGINS', 'CORS_ORIGINS'],
    devDefaults: ['http://localhost:5174'],
    label: 'admin API',
  });
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    exposedHeaders: ['Content-Disposition', 'X-Request-Id'],
  });

  fastifyInstance.addHook('onRequest', async (request, reply) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
    const origin = request.headers.origin;
    if (!origin || !corsOrigins.includes(origin)) {
      reply.code(403).send({ code: 403, message: 'Forbidden: origin mismatch', data: null });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('ruidong admin API')
      .setDescription('管理安全域 API — admin 控制平面、运营、审计')
      .setVersion('1.0.0')
      .addCookieAuth('admin_access_token')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.ADMIN_PORT || 3001;
  await app.listen(port, '0.0.0.0');
}

void bootstrap();

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
