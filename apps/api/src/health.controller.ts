import { Controller, Get, Logger, Optional, Res } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { ApiResponse } from '@ruidong/shared';
import { AlertEventService } from './alert-events/alert-events.service';
import { Public } from './common/decorators/public.decorator';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';

interface ReadinessCheck {
  status: 'ok' | 'down';
  latencyMs?: number;
  error?: string;
}

interface ReadinessPayload {
  status: 'ok' | 'degraded';
  checks: { db: ReadinessCheck; redis: ReadinessCheck };
  uptimeMs: number;
}

const READINESS_TIMEOUT_MS = 1500;

async function runCheck(
  name: string,
  run: () => Promise<unknown>,
  logger: Logger,
): Promise<ReadinessCheck> {
  const started = Date.now();
  try {
    await Promise.race([
      run(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${name} check timed out`)), READINESS_TIMEOUT_MS),
      ),
    ]);
    return { status: 'ok', latencyMs: Date.now() - started };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`readiness check failed: ${name} → ${message}`);
    return { status: 'down', latencyMs: Date.now() - started, error: message };
  }
}

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    // P2-A3 §8.2 系统健康占位:redis ping 失败时发 SYSTEM 告警。
    // @Optional 让 health.controller.spec 可继续不 wire alert 服务。
    @Optional() private readonly alertEvents?: AlertEventService,
  ) {}

  // Liveness: process is up. Kubernetes/Docker use this to decide restart.
  // Deliberately cheap — no downstream calls, never returns non-200.
  @Public()
  @Get('live')
  live(): ApiResponse<{ status: string; uptimeMs: number }> {
    return {
      code: 0,
      message: 'ok',
      data: { status: 'alive', uptimeMs: Date.now() - this.startedAt },
    };
  }

  // Readiness: process can serve traffic. Load balancer should route only
  // when this returns 200. DB or Redis down → 503 so ALB/k8s take us out.
  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<ApiResponse<ReadinessPayload>> {
    const [dbCheck, redisCheck] = await Promise.all([
      runCheck('db', () => this.prisma.$queryRaw`SELECT 1`, this.logger),
      runCheck('redis', () => this.redis.ping(), this.logger),
    ]);

    const allHealthy = dbCheck.status === 'ok' && redisCheck.status === 'ok';
    if (!allHealthy) reply.status(503);

    // P2-A3 §8.2 占位:redis 不可达时发一条 SYSTEM 告警(5min 去重防雪崩)。
    // 这是后续 Sentry / Prometheus 真实接入前的示例性 hook,不阻塞 ready 响应。
    // 错误完全 swallow —— health check 不能因为 alert 写入失败而把状态从 503 升级到 500。
    if (redisCheck.status === 'down' && this.alertEvents) {
      void this.alertEvents
        .createSystemAlert({
          metric: 'redis_unreachable',
          value: 0,
          threshold: 1,
          severity: 'CRITICAL',
          message: `Redis ping 失败:${redisCheck.error ?? 'unknown'}`,
          context: {
            error: redisCheck.error,
            latencyMs: redisCheck.latencyMs,
          },
        })
        .catch((err) => {
          this.logger.warn(
            `health alert creation failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
    }

    return {
      code: allHealthy ? 0 : 1,
      message: allHealthy ? 'ok' : 'degraded',
      data: {
        status: allHealthy ? 'ok' : 'degraded',
        checks: { db: dbCheck, redis: redisCheck },
        uptimeMs: Date.now() - this.startedAt,
      },
    };
  }

  // Backward-compat: existing Nginx/ALB/deploy scripts still hit /health.
  // Route it to readiness so a fake "healthy" response no longer slips past
  // monitoring. When every caller is migrated to /health/ready, delete this.
  @Public()
  @Get()
  async check(@Res({ passthrough: true }) reply: FastifyReply): Promise<ApiResponse<ReadinessPayload>> {
    return this.ready(reply);
  }
}
