import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UserInternalClient } from './user-internal.client';

@Module({
  imports: [ConfigModule],
  providers: [UserInternalClient],
  exports: [UserInternalClient],
})
export class UserInternalClientModule {}
