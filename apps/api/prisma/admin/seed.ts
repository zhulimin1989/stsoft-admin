import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { ADMIN_PRESET_ROLE_PERMISSIONS, BCRYPT_SALT_ROUNDS } from '@ruidong/shared';
import type { AdminPresetRole } from '@ruidong/shared';

const adminDatabaseUrl = process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL;

if (!adminDatabaseUrl) {
  throw new Error('ADMIN_DATABASE_URL is required to seed ruidong_admin');
}

const prisma = new PrismaClient({
  datasources: {
    db: { url: adminDatabaseUrl },
  },
});

const roleDefs: {
  key: AdminPresetRole;
  name: string;
  description: string;
  sortOrder: number;
}[] = [
  { key: 'super_admin', name: '超级管理员', description: '拥有所有权限', sortOrder: 0 },
  { key: 'admin', name: '管理员', description: '除成员管理外的所有权限', sortOrder: 1 },
  { key: 'operator', name: '运营', description: '用户管理、订单处理、内容运营', sortOrder: 2 },
  { key: 'finance', name: '财务', description: '财务数据查看和分析', sortOrder: 3 },
  { key: 'viewer', name: '只读', description: '查看基础数据', sortOrder: 4 },
];

async function main() {
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.SEED_ALLOW_PRODUCTION !== 'true'
  ) {
    throw new Error(
      'admin seed refuses to run in NODE_ENV=production. Set SEED_ALLOW_PRODUCTION=true to override.',
    );
  }

  for (const roleDef of roleDefs) {
    const permissions = JSON.stringify(ADMIN_PRESET_ROLE_PERMISSIONS[roleDef.key]);
    await prisma.adminRole.upsert({
      where: { key: roleDef.key },
      update: {
        name: roleDef.name,
        description: roleDef.description,
        permissions,
        isSystem: true,
        isActive: true,
        sortOrder: roleDef.sortOrder,
      },
      create: {
        key: roleDef.key,
        name: roleDef.name,
        description: roleDef.description,
        permissions,
        isSystem: true,
        sortOrder: roleDef.sortOrder,
      },
    });
  }

  const superAdminRole = await prisma.adminRole.findUnique({
    where: { key: 'super_admin' },
  });
  const adminPassword = await bcrypt.hash('admin123', BCRYPT_SALT_ROUNDS);

  await prisma.adminMember.upsert({
    where: { email: 'admin@iruidong.com' },
    update: {
      password: adminPassword,
      presetRole: 'super_admin',
      permissions: '{}',
      roleId: superAdminRole?.id ?? null,
      isActive: true,
    },
    create: {
      email: 'admin@iruidong.com',
      nickname: '超级管理员',
      password: adminPassword,
      presetRole: 'super_admin',
      permissions: '{}',
      invitedBy: 'system',
      roleId: superAdminRole?.id ?? null,
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
