import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminCoreModule } from './admin-core.module';
import { BillingClientModule } from '../billing/billing-client.module';
import { InvoiceAdminProxyController } from '../billing/invoice-admin-proxy.controller';
import { EnterpriseAccountAdminProxyController } from '../billing/enterprise-account-admin-proxy.controller';
import { EnterpriseAccountAdminV2Controller } from '../billing/enterprise-account-admin-v2.controller';
import { EnterpriseBillMonthSummariesAdminController } from '../billing/enterprise-bill-month-summaries-admin.controller';
import { UserInternalClientModule } from '../user/user-internal-client.module';
import { AdminPermissionGuard } from '../common/guards/admin-permission.guard';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard';
import { DeploymentConfigSyncService } from './deployment-config-sync.service';
import { EnterpriseAdminProxyController } from '../enterprise-admin/enterprise-admin-proxy.controller';
import { EnterpriseAdminProxyService } from '../enterprise-admin/enterprise-admin-proxy.service';

@Module({
  imports: [
    BillingClientModule,
    AdminCoreModule,
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
  controllers: [
    AdminController,
    InvoiceAdminProxyController,
    EnterpriseAccountAdminProxyController,
    EnterpriseAccountAdminV2Controller,
    EnterpriseBillMonthSummariesAdminController,
    EnterpriseAdminProxyController,
  ],
  providers: [
    AdminService,
    AdminJwtAuthGuard,
    AdminPermissionGuard,
    DeploymentConfigSyncService,
    EnterpriseAdminProxyService,
  ],
  exports: [AdminCoreModule],
})
export class AdminModule {}
