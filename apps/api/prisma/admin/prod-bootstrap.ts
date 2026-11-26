import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { ADMIN_PRESET_ROLE_PERMISSIONS, BCRYPT_SALT_ROUNDS } from '@ruidong/shared';
import type { AdminPresetRole } from '@ruidong/shared';

const adminDatabaseUrl = process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL;

if (!adminDatabaseUrl) {
  throw new Error('ADMIN_DATABASE_URL is required for admin production bootstrap');
}

const prisma = new PrismaClient({
  datasources: {
    db: { url: adminDatabaseUrl },
  },
});

const roleDefs: { key: AdminPresetRole; name: string; description: string; sortOrder: number }[] = [
  { key: 'super_admin', name: '超级管理员', description: '拥有所有权限', sortOrder: 0 },
  { key: 'admin', name: '管理员', description: '除成员管理外的所有权限', sortOrder: 1 },
  { key: 'operator', name: '运营', description: '用户管理、订单处理、内容运营', sortOrder: 2 },
  { key: 'finance', name: '财务', description: '财务数据查看和分析', sortOrder: 3 },
  { key: 'viewer', name: '只读', description: '查看基础数据', sortOrder: 4 },
];

async function main() {
  for (const roleDef of roleDefs) {
    await prisma.adminRole.upsert({
      where: { key: roleDef.key },
      update: {
        name: roleDef.name,
        description: roleDef.description,
        permissions: JSON.stringify(ADMIN_PRESET_ROLE_PERMISSIONS[roleDef.key]),
        isSystem: true,
        isActive: true,
        sortOrder: roleDef.sortOrder,
      },
      create: {
        key: roleDef.key,
        name: roleDef.name,
        description: roleDef.description,
        permissions: JSON.stringify(ADMIN_PRESET_ROLE_PERMISSIONS[roleDef.key]),
        isSystem: true,
        sortOrder: roleDef.sortOrder,
      },
    });
  }

  const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim();
  const passwordHash = process.env.ADMIN_BOOTSTRAP_PASSWORD_HASH?.trim();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD?.trim();

  if (!email) {
    console.log('Admin roles bootstrapped. ADMIN_BOOTSTRAP_EMAIL not set; skipped super admin creation.');
    return;
  }
  if (!passwordHash && !password) {
    throw new Error('ADMIN_BOOTSTRAP_PASSWORD_HASH or ADMIN_BOOTSTRAP_PASSWORD is required when ADMIN_BOOTSTRAP_EMAIL is set');
  }

  const superAdminRole = await prisma.adminRole.findUnique({ where: { key: 'super_admin' } });
  const finalHash = passwordHash || await bcrypt.hash(password!, BCRYPT_SALT_ROUNDS);

  await prisma.adminMember.upsert({
    where: { email },
    update: {
      password: finalHash,
      presetRole: 'super_admin',
      permissions: '{}',
      roleId: superAdminRole?.id ?? null,
      isActive: true,
      mustChangePassword: Boolean(password),
    },
    create: {
      email,
      nickname: process.env.ADMIN_BOOTSTRAP_NICKNAME || '超级管理员',
      password: finalHash,
      presetRole: 'super_admin',
      permissions: '{}',
      invitedBy: 'production-bootstrap',
      roleId: superAdminRole?.id ?? null,
      mustChangePassword: Boolean(password),
    },
  });

  console.log(`Production bootstrap completed for ruidong_admin: ${email}`);
}

main().finally(async () => prisma.$disconnect());
