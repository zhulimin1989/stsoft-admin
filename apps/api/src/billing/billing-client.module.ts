import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BillingInternalClient } from './billing-internal.client';
import { EnterpriseBillsInternalClient } from './enterprise-bills-internal.client';
import { BillingPortalClient } from './billing-portal.client';

@Module({
  imports: [ConfigModule],
  providers: [BillingInternalClient, EnterpriseBillsInternalClient, BillingPortalClient],
  exports: [BillingInternalClient, EnterpriseBillsInternalClient, BillingPortalClient],
})
export class BillingClientModule {}
