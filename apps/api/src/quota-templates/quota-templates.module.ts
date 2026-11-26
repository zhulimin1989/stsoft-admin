import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { BillingClientModule } from '../billing/billing-client.module';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard';
import { AdminPermissionGuard } from '../common/guards/admin-permission.guard';
import { QuotaTemplatesController } from './quota-templates.controller';

@Module({
  imports: [
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
  controllers: [QuotaTemplatesController],
  providers: [AdminJwtAuthGuard, AdminPermissionGuard],
})
export class QuotaTemplatesModule {}
