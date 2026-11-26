import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { SentryModule, SentryGlobalFilter } from '@sentry/nestjs/setup';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { BillingProxyModule } from './billing/billing-proxy.module';
import { AdminModule } from './admin/admin.module';
import { MetricsModule } from './metrics/metrics.module';
import { RechargeTiersModule } from './recharge-tiers/recharge-tiers.module';
import { UserSegmentsModule } from './user-segments/user-segments.module';
import { TicketsModule } from './tickets/tickets.module';
import { RiskModule } from './risk/risk.module';
import { QuotaTemplatesModule } from './quota-templates/quota-templates.module';
import { CampaignModule } from './campaign/campaign.module';
import { CreditGrantsModule } from './credit-grants/credit-grants.module';
import { CreditPolicyModule } from './credit-policy/credit-policy.module';
import { FunnelModule } from './funnel/funnel.module';
import { AlertEventsModule } from './alert-events/alert-events.module';
import { ReferralsModule } from './referrals/referrals.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { createLoggerConfig } from './common/logger/logger.config';
import { AdminRequestContextInterceptor } from './common/interceptors/admin-request-context.interceptor';

@Module({
  imports: [
    // Sentry integration. The actual init() call lives in instrument.ts
    // and runs before any Nest module is imported. SentryModule just
    // registers the DI plumbing so we can @InjectSentry etc. if needed.
    SentryModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../../.env', '/app/.env'],
    }),
    LoggerModule.forRoot(createLoggerConfig()),
    PrismaModule,
    RedisModule,
    BillingProxyModule,
    AdminModule,
    RechargeTiersModule,
    UserSegmentsModule,
    TicketsModule,
    RiskModule,
    QuotaTemplatesModule,
    CampaignModule,
    CreditGrantsModule,
    CreditPolicyModule,
    FunnelModule,
    AlertEventsModule,
    ReferralsModule,
    MetricsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Sentry filter MUST come before HttpExceptionFilter — it needs to
    // observe uncaught exceptions before the app's own filter rewrites
    // them into ApiResponse envelopes. Nest evaluates APP_FILTER providers
    // in registration order (last registered = innermost = runs first).
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AdminRequestContextInterceptor,
    },
  ],
})
export class AppModule {}
