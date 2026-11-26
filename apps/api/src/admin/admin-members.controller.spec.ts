import { Test, TestingModule } from '@nestjs/testing';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard';
import { AdminPermissionGuard } from '../common/guards/admin-permission.guard';

describe('AdminController - Members', () => {
  let controller: AdminController;
  let service: jest.Mocked<Pick<
    AdminService,
    | 'listAdminMembers'
    | 'inviteAdminMember'
    | 'updateAdminMember'
    | 'removeAdminMember'
    | 'forceLogout'
    | 'resetAdminPassword'
  >>;

  beforeEach(async () => {
    service = {
      listAdminMembers: jest.fn().mockResolvedValue([{ id: '1', email: 'a@test.com', presetRole: 'admin' }]),
      inviteAdminMember: jest.fn().mockResolvedValue({ id: '2', email: 'new@t.com', temporaryPassword: 'abc' }),
      updateAdminMember: jest.fn().mockResolvedValue({ id: '2', presetRole: 'operator' }),
      removeAdminMember: jest.fn().mockResolvedValue(undefined),
      forceLogout: jest.fn().mockResolvedValue(undefined),
      resetAdminPassword: jest.fn().mockResolvedValue({ tempPassword: 'abc123def456' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [{ provide: AdminService, useValue: service }],
    })
      .overrideGuard(AdminJwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(AdminPermissionGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AdminController);
  });

  it('listMembers returns member list', async () => {
    const result = await controller.listMembers();
    expect(result).toEqual({ code: 0, message: 'ok', data: expect.any(Array) });
    expect(service.listAdminMembers).toHaveBeenCalled();
  });

  it('inviteMember creates admin member', async () => {
    const result = await controller.inviteMember(
      { email: 'new@t.com', roleId: 'role-1' },
      { id: 'inv-1' },
    );
    expect(result.code).toBe(0);
    expect(service.inviteAdminMember).toHaveBeenCalledWith('new@t.com', 'role-1', 'inv-1', { name: undefined, phone: undefined, department: undefined });
  });

  it('updateMember updates member', async () => {
    const result = await controller.updateMember('2', { presetRole: 'operator' }, 'admin-1');
    expect(result.code).toBe(0);
    expect(service.updateAdminMember).toHaveBeenCalledWith(
      '2',
      { presetRole: 'operator' },
      'admin-1',
    );
  });

  it('removeMember deletes member', async () => {
    const result = await controller.removeMember('1');
    expect(result.code).toBe(0);
  });
});
