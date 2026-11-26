import { Injectable } from '@nestjs/common';
import { AdminMember, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export interface AdminMemberRow {
  id: string;
  email: string;
  password: string;
  nickname: string;
  presetRole: string;
  permissions: string;
  isActive: boolean;
  invitedBy: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  roleId: string | null;
  name: string;
  phone: string | null;
  department: string | null;
  lastLoginAt: Date | string | null;
  passwordChangedAt: Date | string | null;
  mustChangePassword: boolean;
}

type AdminMemberNormalizeInput = Partial<AdminMember> & {
  id: string;
  email: string;
  password: string;
  nickname: string;
  preset_role?: string;
  is_active?: boolean;
  invited_by?: string | null;
  created_at?: Date | string;
  updated_at?: Date | string;
  role_id?: string | null;
  last_login_at?: Date | string | null;
  password_changed_at?: Date | string | null;
  must_change_password?: boolean;
};

function normalizeAdminMember(raw: AdminMemberNormalizeInput): AdminMemberRow {
  return {
    id: raw.id,
    email: raw.email,
    password: raw.password,
    nickname: raw.nickname,
    presetRole: raw.preset_role ?? raw.presetRole ?? 'member',
    permissions: raw.permissions ?? '{}',
    isActive: raw.is_active ?? raw.isActive ?? true,
    invitedBy: raw.invited_by ?? raw.invitedBy ?? null,
    createdAt: raw.created_at ?? raw.createdAt ?? new Date(0),
    updatedAt: raw.updated_at ?? raw.updatedAt ?? new Date(0),
    roleId: raw.role_id ?? raw.roleId ?? null,
    name: raw.name ?? '',
    phone: raw.phone ?? null,
    department: raw.department ?? null,
    lastLoginAt: raw.last_login_at ?? raw.lastLoginAt ?? null,
    passwordChangedAt: raw.password_changed_at ?? raw.passwordChangedAt ?? null,
    mustChangePassword: raw.must_change_password ?? raw.mustChangePassword ?? false,
  };
}

@Injectable()
export class AdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAuditLogs(
    skip: number,
    take: number,
    filters?: { action?: string; resource?: string; search?: string },
  ) {
    const where: Prisma.AuditLogWhereInput = {};
    if (filters?.action) where.action = filters.action;
    if (filters?.resource) where.resource = filters.resource;
    const search = filters?.search?.trim();
    if (search) {
      where.OR = [
        { userId: { contains: search, mode: 'insensitive' } },
        { targetUserId: { contains: search, mode: 'insensitive' } },
        { resourceId: { contains: search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  async countAuditLogs(filters?: { action?: string; resource?: string; search?: string }) {
    const where: Prisma.AuditLogWhereInput = {};
    if (filters?.action) where.action = filters.action;
    if (filters?.resource) where.resource = filters.resource;
    const search = filters?.search?.trim();
    if (search) {
      where.OR = [
        { userId: { contains: search, mode: 'insensitive' } },
        { targetUserId: { contains: search, mode: 'insensitive' } },
        { resourceId: { contains: search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.auditLog.count({ where });
  }

  async findAlerts() {
    return this.prisma.alert.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async createAlert(data: Prisma.AlertCreateInput) {
    return this.prisma.alert.create({ data });
  }

  async updateAlert(id: string, data: Prisma.AlertUpdateInput) {
    return this.prisma.alert.update({ where: { id }, data });
  }

  async deleteAlert(id: string) {
    return this.prisma.alert.delete({ where: { id } });
  }

  async findAnnouncements(skip: number, take: number) {
    return this.prisma.announcement.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  async countAnnouncements() {
    return this.prisma.announcement.count();
  }

  async createAnnouncement(data: Prisma.AnnouncementCreateInput) {
    return this.prisma.announcement.create({ data });
  }

  async findAnnouncementById(id: string) {
    return this.prisma.announcement.findUnique({ where: { id } });
  }

  async updateAnnouncement(id: string, data: Prisma.AnnouncementUpdateInput) {
    return this.prisma.announcement.update({ where: { id }, data });
  }

  async deleteAnnouncement(id: string) {
    return this.prisma.announcement.delete({ where: { id } });
  }

  async findFeatureFlags() {
    return this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
  }

  async upsertFeatureFlag(
    key: string,
    data: {
      value: boolean;
      description: string;
      scope: string;
      scopeValue: string | null;
    },
  ) {
    return this.prisma.featureFlag.upsert({
      where: { key },
      update: data,
      create: { key, ...data },
    });
  }

  async findSystemPrompts() {
    return this.prisma.systemPrompt.findMany({ orderBy: { key: 'asc' } });
  }

  async findSystemPromptById(id: string) {
    return this.prisma.systemPrompt.findUnique({ where: { id } });
  }

  async findSystemPromptByKey(key: string) {
    return this.prisma.systemPrompt.findUnique({ where: { key } });
  }

  async upsertSystemPrompt(
    key: string,
    data: Prisma.SystemPromptUpdateInput,
    createData: Prisma.SystemPromptCreateInput,
  ) {
    return this.prisma.systemPrompt.upsert({
      where: { key },
      update: data,
      create: createData,
    });
  }

  async findSystemConfigs() {
    return this.prisma.systemConfig.findMany({ orderBy: { key: 'asc' } });
  }

  async findSystemConfig(key: string) {
    return this.prisma.systemConfig.findUnique({ where: { key } });
  }

  /**
   * Compare-and-swap the source snapshot. Returning null means another request won
   * the race; callers must re-read, merge, and retry so concurrent section saves do
   * not overwrite each other.
   */
  async upsertDeploymentConfig(value: string, expectedVersion: bigint) {
    const updated = await this.prisma.systemConfig.updateMany({
      where: { key: 'deploymentConfig', version: expectedVersion },
      data: { value, version: expectedVersion + 1n },
    });
    if (updated.count === 1) {
      return this.prisma.systemConfig.findUnique({ where: { key: 'deploymentConfig' } });
    }
    if (expectedVersion !== 0n) return null;

    try {
      return await this.prisma.systemConfig.create({
        data: {
          key: 'deploymentConfig',
          value,
          version: 1,
          description: '统一部署运行时配置；provider 由 region 派生',
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) return null;
      throw error;
    }
  }

  /** Older reconciliation attempts must never replace status for a newer version. */
  async upsertDeploymentConfigSyncStatus(value: string, version: bigint): Promise<void> {
    const key = 'deploymentConfigSyncStatus';
    const updated = await this.prisma.systemConfig.updateMany({
      where: { key, version: { lte: version } },
      data: { value, version },
    });
    if (updated.count === 1) return;

    const existing = await this.prisma.systemConfig.findUnique({ where: { key } });
    if (existing) return;
    try {
      await this.prisma.systemConfig.create({ data: { key, value, version } });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      await this.prisma.systemConfig.updateMany({
        where: { key, version: { lte: version } },
        data: { value, version },
      });
    }
  }

  async upsertSystemConfig(key: string, value: string) {
    return this.prisma.systemConfig.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  async findRoles() {
    return this.prisma.adminRole.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { members: true } } },
    });
  }

  async findRoleById(id: string) {
    return this.prisma.adminRole.findUnique({
      where: { id },
      include: { _count: { select: { members: true } } },
    });
  }

  async findRoleByKey(key: string) {
    return this.prisma.adminRole.findUnique({ where: { key } });
  }

  async createRole(data: {
    name: string;
    description?: string;
    permissions?: string;
    key?: string;
    sortOrder?: number;
  }) {
    return this.prisma.adminRole.create({
      data: {
        name: data.name,
        description: data.description ?? '',
        permissions: data.permissions ?? '[]',
        key: data.key ?? null,
        sortOrder: data.sortOrder ?? 0,
      },
    });
  }

  async updateRole(
    id: string,
    data: {
      name?: string;
      description?: string;
      permissions?: string;
      key?: string;
      isActive?: boolean;
      sortOrder?: number;
    },
  ) {
    return this.prisma.adminRole.update({ where: { id }, data });
  }

  async deleteRole(id: string) {
    return this.prisma.adminRole.delete({ where: { id } });
  }

  async findAdminMemberForAuth(email: string): Promise<AdminMemberRow | null> {
    const row = await this.prisma.adminMember.findUnique({ where: { email } });
    return row ? normalizeAdminMember(row) : null;
  }

  async findAdminMemberById(id: string): Promise<AdminMemberRow | null> {
    const row = await this.prisma.adminMember.findUnique({ where: { id } });
    return row ? normalizeAdminMember(row) : null;
  }

  async findAdminMemberByEmail(email: string): Promise<AdminMemberRow | null> {
    const row = await this.prisma.adminMember.findUnique({ where: { email } });
    return row ? normalizeAdminMember(row) : null;
  }

  async findAdminMembers(): Promise<(AdminMemberRow & { roleName?: string | null })[]> {
    const rows = await this.prisma.adminMember.findMany({
      orderBy: { createdAt: 'desc' },
      include: { role: { select: { name: true } } },
    });
    return rows.map((row) => ({
      ...normalizeAdminMember(row),
      roleName: row.role?.name ?? null,
    }));
  }

  async createAdminMember(data: {
    email: string;
    password: string;
    nickname: string;
    presetRole: string;
    invitedBy: string;
    roleId?: string | null;
    name?: string;
    phone?: string | null;
    department?: string | null;
    mustChangePassword?: boolean;
  }): Promise<AdminMemberRow> {
    const row = await this.prisma.adminMember.create({
      data: {
        email: data.email,
        password: data.password,
        nickname: data.nickname,
        presetRole: data.presetRole,
        invitedBy: data.invitedBy,
        isActive: true,
        permissions: '{}',
        roleId: data.roleId ?? null,
        name: data.name ?? '',
        phone: data.phone ?? null,
        department: data.department ?? null,
        mustChangePassword: data.mustChangePassword ?? false,
      },
    });
    return normalizeAdminMember(row);
  }

  async updateAdminMember(
    id: string,
    data: {
      presetRole?: string;
      permissions?: string;
      isActive?: boolean;
      roleId?: string | null;
      name?: string;
      phone?: string | null;
      department?: string | null;
    },
  ): Promise<AdminMemberRow> {
    const update: Prisma.AdminMemberUpdateInput = {};
    if (data.presetRole !== undefined) update.presetRole = data.presetRole;
    if (data.permissions !== undefined) update.permissions = data.permissions;
    if (data.isActive !== undefined) update.isActive = data.isActive;
    if (data.roleId !== undefined) {
      update.role = data.roleId
        ? { connect: { id: data.roleId } }
        : { disconnect: true };
    }
    if (data.name !== undefined) update.name = data.name;
    if (data.phone !== undefined) update.phone = data.phone;
    if (data.department !== undefined) update.department = data.department;

    const row = await this.prisma.adminMember.update({
      where: { id },
      data: update,
    });
    return normalizeAdminMember(row);
  }

  async deleteAdminMember(id: string) {
    await this.prisma.adminMember.delete({ where: { id } });
  }

  async findMemberIdsByRoleId(roleId: string): Promise<string[]> {
    const rows = await this.prisma.adminMember.findMany({
      where: { roleId },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async updateAdminMemberPassword(
    id: string,
    data: {
      password: string;
      mustChangePassword: boolean;
      passwordChangedAt: Date;
    },
  ): Promise<void> {
    await this.prisma.adminMember.update({
      where: { id },
      data: {
        password: data.password,
        mustChangePassword: data.mustChangePassword,
        passwordChangedAt: data.passwordChangedAt,
      },
    });
  }
}
