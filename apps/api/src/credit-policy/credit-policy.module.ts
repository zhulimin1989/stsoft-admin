import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { BillingClientModule } from '../billing/billing-client.module';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard';
import { AdminPermissionGuard } from '../common/guards/admin-permission.guard';
import { CreditPolicyController } from './credit-policy.controller';

/**
 * CreditPolicyModule — admin v2 信用额度策略(/admin/v2/credit-policy)。
 *
 * - 该模块只作为 admin-api proxy 入口,业务读写在 billing-api 内完成。
 * - JwtModule 与既有 admin v2 module 一致(支持 AdminJwtAuthGuard 解析 token)。
 *
 * 详见 docs/superpowers/specs/2026-04-30-admin-v2-backend-p2-credit-policy-design.md
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
  controllers: [CreditPolicyController],
  providers: [AdminJwtAuthGuard, AdminPermissionGuard],
})
export class CreditPolicyModule {}
