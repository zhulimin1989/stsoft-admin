import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard';
import { AdminPermissionGuard } from '../common/guards/admin-permission.guard';
import { UserInternalClientModule } from '../user/user-internal-client.module';
import { RiskFlagsController } from './risk-flags.controller';
import { RiskRulesController } from './risk-rules.controller';

@Module({
  imports: [
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
  controllers: [RiskRulesController, RiskFlagsController],
  providers: [
    AdminJwtAuthGuard,
    AdminPermissionGuard,
  ],
})
export class RiskModule {}
