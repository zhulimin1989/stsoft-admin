import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AdminPresetRole,
  AdminPermissionAtom,
  expandAdminPermissions,
  resolveAdminPermissions,
} from '@ruidong/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  ADMIN_NO_PERMISSION_REQUIRED_KEY,
  ADMIN_PERMISSION_KEY,
} from '../decorators/admin-permission.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { scopedRedisKey } from '../utils/redis-key';

const CACHE_TTL_SECONDS = 300;

@Injectable()
export class AdminPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      targets,
    );
    if (isPublic) {
      return true;
    }

    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      ADMIN_PERMISSION_KEY,
      targets,
    );
    const noPermissionRequired = this.reflector.getAllAndOverride<boolean>(
      ADMIN_NO_PERMISSION_REQUIRED_KEY,
      targets,
    );

    if ((!requiredPermissions || requiredPermissions.length === 0) && !noPermissionRequired) {
      throw new ForbiddenException('后台接口缺少权限配置');
    }

    const request = context.switchToHttp().getRequest();
    const adminId: string | undefined = request.user?.id;

    if (!adminId) {
      throw new ForbiddenException('权限不足');
    }

    const resolvedPermissions = await this.getAdminPermissions(adminId);
    request.user = {
      ...request.user,
      adminPermissions: resolvedPermissions,
    };

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const hasAll = requiredPermissions.every((p) =>
      resolvedPermissions.includes(p),
    );

    if (!hasAll) {
      throw new ForbiddenException('权限不足');
    }

    return true;
  }

  private async getAdminPermissions(adminId: string): Promise<string[]> {
    const cacheKey = scopedRedisKey('admin:perms', adminId);

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return expandAdminPermissions(JSON.parse(cached) as string[]);
      } catch {
        // corrupted cache — fall through to DB
      }
    }

    const admin = await this.prisma.adminMember.findUnique({
      where: { id: adminId },
      select: {
        presetRole: true,
        permissions: true,
        isActive: true,
        roleId: true,
        role: {
          select: {
            permissions: true,
            isActive: true,
          },
        },
      },
    });

    if (!admin) {
      throw new ForbiddenException('管理员不存在');
    }

    if (!admin.isActive) {
      throw new ForbiddenException('账号已停用');
    }

    if (admin.presetRole === 'super_admin') {
      const resolved = resolveAdminPermissions('super_admin');
      await this.redis.set(
        cacheKey,
        JSON.stringify(resolved),
        'EX',
        CACHE_TTL_SECONDS,
      );
      return resolved;
    }

    // Resolve base permissions: prefer role-based, fallback to preset_role
    let basePermissions: string[];
    if (admin.roleId && admin.role?.permissions) {
      // 检查角色是否 active，停用的角色不授予权限
      const roleActive = admin.role.isActive !== false;
      if (roleActive) {
        try {
          basePermissions = JSON.parse(admin.role.permissions) as string[];
        } catch {
          basePermissions = [];
        }
      } else {
        basePermissions = [];
      }
    } else {
      // Fallback to legacy preset_role resolution
      basePermissions = resolveAdminPermissions(
        admin.presetRole as AdminPresetRole,
      );
    }

    let overrides: Partial<Record<AdminPermissionAtom, boolean>> = {};
    if (admin.permissions) {
      try {
        overrides = JSON.parse(admin.permissions) as Partial<
          Record<AdminPermissionAtom, boolean>
        >;
      } catch {
        // ignore malformed overrides
      }
    }

    const resolved = expandAdminPermissions(basePermissions, overrides);

    await this.redis.set(
      cacheKey,
      JSON.stringify(resolved),
      'EX',
      CACHE_TTL_SECONDS,
    );

    return resolved;
  }
}
