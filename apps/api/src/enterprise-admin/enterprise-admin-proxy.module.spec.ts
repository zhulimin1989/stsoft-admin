import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AdminModule } from '../admin/admin.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { RedisService } from '../redis/redis.service';
import { UserInternalClient } from '../user/user-internal.client';
import { AdminActivityLogService } from '../admin/admin-activity-log.service';
import { EnterpriseAdminProxyController } from './enterprise-admin-proxy.controller';
import { EnterpriseAdminProxyService } from './enterprise-admin-proxy.service';
it('production Admin module registers the dedicated proxy with the existing authoritative client and safe activity provider',async()=>{
  const module=await Test.createTestingModule({imports:[ConfigModule.forRoot({isGlobal:true,ignoreEnvFile:true,ignoreEnvVars:true}),PrismaModule,RedisModule,AdminModule]})
    .overrideProvider(ConfigService).useValue(new ConfigService({ADMIN_DATABASE_URL:process.env.ADMIN_DB_TEST_URL,JWT_SECRET:'module-local-jwt',USER_SERVICE_URL:'http://127.0.0.1:1/api/internal/user/admin'}))
    .overrideProvider(RedisService).useValue({}).compile();
  try{const proxy=module.get(EnterpriseAdminProxyService);expect((module.get(EnterpriseAdminProxyController) as any).proxy).toBe(proxy);
    expect((proxy as any).user).toBe(module.get(UserInternalClient));expect((proxy as any).activity).toBe(module.get(AdminActivityLogService));}
  finally{await module.close();}
});
