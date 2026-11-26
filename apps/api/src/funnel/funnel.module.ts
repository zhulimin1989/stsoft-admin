import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { BillingClientModule } from '../billing/billing-client.module';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard';
import { AdminPermissionGuard } from '../common/guards/admin-permission.guard';
import { FunnelController } from './funnel.controller';

/**
 * FunnelModule — admin v2 业务漏斗(/admin/v2/funnel*)。
 *
 * - 该模块只作为 admin-api proxy 入口,聚合与缓存由 billing-api 负责。
 * - 路由权限 admin.monitoring.view,与现有 monitoring 权限对齐。
 */
@Module({
  imports: [
    ConfigModule,
    BillingClientModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '15m' },
      }),
    }),
  ],
  controllers: [FunnelController],
  providers: [AdminJwtAuthGuard, AdminPermissionGuard],
})
export class FunnelModule {}
