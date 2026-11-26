import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { BillingClientModule } from '../billing/billing-client.module';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard';
import { AdminPermissionGuard } from '../common/guards/admin-permission.guard';
import { ReferralsController } from './referrals.controller';
import { UserInternalClientModule } from '../user/user-internal-client.module';

@Module({
  imports: [
    BillingClientModule,
    // 邀请记录列表要用 user 域的权威联系方式补齐 billing 镜像里缺失的 email/phone。
    UserInternalClientModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '15m' },
      }),
    }),
  ],
  controllers: [ReferralsController],
  providers: [AdminJwtAuthGuard, AdminPermissionGuard],
})
export class ReferralsModule {}
