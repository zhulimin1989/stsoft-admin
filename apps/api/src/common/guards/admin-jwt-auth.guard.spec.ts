import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { AdminJwtAuthGuard } from './admin-jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

function createContext(cookies: Record<string, string> = {}): ExecutionContext {
  const request = { cookies };
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('AdminJwtAuthGuard', () => {
  let jwt: { verify: jest.Mock };
  let reflector: { getAllAndOverride: jest.Mock };
  let prisma: { adminMember: { findUnique: jest.Mock } };
  let redis: { get: jest.Mock };
  let guard: AdminJwtAuthGuard;

  beforeEach(() => {
    jwt = { verify: jest.fn().mockReturnValue({ adminId: 'admin-1', presetRole: 'operator' }) };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    prisma = { adminMember: { findUnique: jest.fn().mockResolvedValue({ id: 'admin-1', isActive: true }) } };
    redis = { get: jest.fn().mockResolvedValue(null) };
    guard = new AdminJwtAuthGuard(
      jwt as unknown as JwtService,
      reflector as unknown as Reflector,
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
    );
  });

  it('sets request user for a valid active admin', async () => {
    const ctx = createContext({ admin_access_token: 'token' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    const req = ctx.switchToHttp().getRequest() as any;
    expect(req.user).toEqual({ id: 'admin-1', presetRole: 'operator' });
  });

  it('rejects force-logged-out access tokens immediately', async () => {
    redis.get.mockResolvedValue('1');

    await expect(guard.canActivate(createContext({ admin_access_token: 'token' })))
      .rejects.toThrow(UnauthorizedException);
    expect(prisma.adminMember.findUnique).not.toHaveBeenCalled();
  });

  it('rejects inactive admins even before permission metadata is evaluated', async () => {
    prisma.adminMember.findUnique.mockResolvedValue({ id: 'admin-1', isActive: false });

    await expect(guard.canActivate(createContext({ admin_access_token: 'token' })))
      .rejects.toThrow(UnauthorizedException);
  });
});
