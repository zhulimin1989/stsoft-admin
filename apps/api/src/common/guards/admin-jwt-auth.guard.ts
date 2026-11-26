import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { FastifyRequest } from 'fastify';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { scopedRedisKey } from '../utils/redis-key';

type AdminAuthRequest = FastifyRequest & {
  cookies?: {
    admin_access_token?: string;
  };
  user?: {
    id: string;
    presetRole?: string;
  };
};

type AdminJwtPayload = {
  sub: string;
  adminId?: string;
  presetRole?: string;
};

@Injectable()
export class AdminJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AdminAuthRequest>();
    const token = request.cookies?.admin_access_token;

    if (!token) {
      throw new UnauthorizedException('未登录');
    }

    let payload: AdminJwtPayload;
    try {
      payload = this.jwtService.verify<AdminJwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Token 无效或已过期');
    }

    if (!payload.adminId) {
      throw new UnauthorizedException('无效的管理端 Token');
    }

    const forceLogoutAt = await this.redis.get(scopedRedisKey('admin:force_logout', payload.adminId));
    if (forceLogoutAt) {
      throw new UnauthorizedException('已被强制下线，请重新登录');
    }

    const member = await this.prisma.adminMember.findUnique({
      where: { id: payload.adminId },
      select: { id: true, isActive: true },
    });
    if (!member || !member.isActive) {
      throw new UnauthorizedException('管理员不存在或已禁用');
    }

    request.user = {
      id: payload.adminId,
      presetRole: payload.presetRole,
    };

    return true;
  }
}
