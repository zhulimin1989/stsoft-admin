import { Injectable, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, Prisma } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(@Optional() config?: ConfigService) {
    super(createPrismaClientOptions(config));
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

export function resolvePrismaDatasourceUrl(
  env: NodeJS.ProcessEnv,
  config?: Pick<ConfigService, 'get'>,
): string | undefined {
  const isProductionRuntime =
    config?.get<string>('NODE_ENV') === 'production' ||
    env.NODE_ENV === 'production' ||
    config?.get<string>('APP_ENV') === 'production' ||
    env.APP_ENV === 'production';
  const adminDatabaseUrl = config?.get<string>('ADMIN_DATABASE_URL') ||
    env.ADMIN_DATABASE_URL;
  if (adminDatabaseUrl) return adminDatabaseUrl;
  if (isProductionRuntime) {
    throw new Error('ADMIN_DATABASE_URL is required for admin-api in production');
  }
  return config?.get<string>('ADMIN_DATABASE_URL') ||
    env.ADMIN_DATABASE_URL ||
    config?.get<string>('DATABASE_URL') ||
    env.DATABASE_URL;
}

function createPrismaClientOptions(config?: ConfigService): Prisma.PrismaClientOptions | undefined {
  const url = resolvePrismaDatasourceUrl(process.env, config);
  if (!url) return undefined;
  return {
    datasources: {
      db: { url },
    },
  };
}
