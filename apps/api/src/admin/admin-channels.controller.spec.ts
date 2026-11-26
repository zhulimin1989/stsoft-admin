import { PATH_METADATA } from '@nestjs/common/constants';
import { ADMIN_PERMISSION_KEY } from '../common/decorators/admin-permission.decorator';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

describe('AdminController - Channels', () => {
  it('proxies channel protocol templates through admin API', async () => {
    const payload = { contractVersion: '2026-06-01', items: [] };
    const service = {
      getChannelProtocolTemplates: jest.fn().mockResolvedValue(payload),
    } as unknown as jest.Mocked<Pick<AdminService, 'getChannelProtocolTemplates'>>;
    const controller = new AdminController(service as unknown as AdminService);

    const requiredPermissions = Reflect.getMetadata(
      ADMIN_PERMISSION_KEY,
      AdminController.prototype.getChannelProtocolTemplates,
    );
    const path = Reflect.getMetadata(
      PATH_METADATA,
      AdminController.prototype.getChannelProtocolTemplates,
    );
    const result = await controller.getChannelProtocolTemplates();

    expect(path).toBe('channels/protocol-templates');
    expect(requiredPermissions).toEqual(['admin.catalog.channels.view']);
    expect(service.getChannelProtocolTemplates).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ code: 0, message: 'ok', data: payload });
  });

  it('proxies provider account identity lifecycle with channel permissions', async () => {
    const identities = [{
      id: 'identity-1',
      ref: 'pa_identity_1',
      providerCode: 'kimi',
      displayName: 'Kimi 主账户',
      status: 'active',
    }];
    const service = {
      listProviderAccountIdentities: jest.fn().mockResolvedValue(identities),
      createProviderAccountIdentity: jest.fn().mockResolvedValue(identities[0]),
      deactivateProviderAccountIdentity: jest.fn().mockResolvedValue({
        ...identities[0],
        status: 'inactive',
      }),
    } as unknown as jest.Mocked<Pick<
      AdminService,
      | 'listProviderAccountIdentities'
      | 'createProviderAccountIdentity'
      | 'deactivateProviderAccountIdentity'
    >>;
    const controller = new AdminController(service as unknown as AdminService);
    const listPermissions = Reflect.getMetadata(
      ADMIN_PERMISSION_KEY,
      AdminController.prototype.listProviderAccountIdentities,
    );
    const createPermissions = Reflect.getMetadata(
      ADMIN_PERMISSION_KEY,
      AdminController.prototype.createProviderAccountIdentity,
    );
    const deactivatePermissions = Reflect.getMetadata(
      ADMIN_PERMISSION_KEY,
      AdminController.prototype.deactivateProviderAccountIdentity,
    );
    const paths = [
      AdminController.prototype.listProviderAccountIdentities,
      AdminController.prototype.createProviderAccountIdentity,
      AdminController.prototype.deactivateProviderAccountIdentity,
    ].map((handler) => Reflect.getMetadata(PATH_METADATA, handler));

    await expect(controller.listProviderAccountIdentities()).resolves.toEqual({
      code: 0,
      message: 'ok',
      data: identities,
    });
    await expect(controller.createProviderAccountIdentity({
      providerCode: 'kimi',
      displayName: 'Kimi 主账户',
    })).resolves.toEqual({
      code: 0,
      message: '创建成功',
      data: identities[0],
    });
    await expect(controller.deactivateProviderAccountIdentity('identity-1')).resolves.toEqual({
      code: 0,
      message: '已停用',
      data: { ...identities[0], status: 'inactive' },
    });

    expect(listPermissions).toEqual(['admin.catalog.channels.view']);
    expect(createPermissions).toEqual(['admin.data.channels.manage']);
    expect(deactivatePermissions).toEqual(['admin.data.channels.manage']);
    expect(paths).toEqual([
      'provider-account-identities',
      'provider-account-identities',
      'provider-account-identities/:id/deactivate',
    ]);
    expect(service.createProviderAccountIdentity).toHaveBeenCalledWith({
      providerCode: 'kimi',
      displayName: 'Kimi 主账户',
    });
    expect(service.deactivateProviderAccountIdentity).toHaveBeenCalledWith('identity-1');
  });

  it('returns billing publisher sync payloads from product route deletes', async () => {
    const payload = {
      id: 'pc-1',
      publisherSync: { status: 'accepted', jobId: 'job-1' },
    };
    const service = {
      deleteProductChannel: jest.fn().mockResolvedValue(payload),
      deleteProductChannelGroup: jest.fn().mockResolvedValue({ ...payload, id: 'grp-1' }),
      deleteProductChannelGroupMember: jest.fn().mockResolvedValue({ ...payload, id: 'member-1' }),
    } as unknown as jest.Mocked<Pick<
      AdminService,
      'deleteProductChannel' | 'deleteProductChannelGroup' | 'deleteProductChannelGroupMember'
    >>;
    const controller = new AdminController(service as unknown as AdminService);

    await expect(controller.deleteProductChannel('prod-1', 'pc-1')).resolves.toEqual({
      code: 0,
      message: '删除成功',
      data: payload,
    });
    await expect(controller.deleteProductChannelGroup('prod-1', 'grp-1')).resolves.toEqual({
      code: 0,
      message: '删除成功',
      data: { ...payload, id: 'grp-1' },
    });
    await expect(controller.deleteProductChannelGroupMember('prod-1', 'grp-1', 'member-1')).resolves.toEqual({
      code: 0,
      message: '删除成功',
      data: { ...payload, id: 'member-1' },
    });
  });
});
