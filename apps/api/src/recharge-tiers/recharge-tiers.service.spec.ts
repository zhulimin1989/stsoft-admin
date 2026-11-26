import { Test } from '@nestjs/testing';
import { BillingInternalClient } from '../billing/billing-internal.client';
import { RechargeTiersService } from './recharge-tiers.service';

describe('RechargeTiersService', () => {
  let service: RechargeTiersService;
  let billingClient: jest.Mocked<Pick<
    BillingInternalClient,
    | 'listRechargeTierProducts'
    | 'listRechargeTiers'
    | 'getRechargeTier'
    | 'createRechargeTier'
    | 'updateRechargeTier'
    | 'deleteRechargeTier'
    | 'cloneRechargeTier'
  >>;

  beforeEach(async () => {
    billingClient = {
      listRechargeTierProducts: jest.fn(),
      listRechargeTiers: jest.fn(),
      getRechargeTier: jest.fn(),
      createRechargeTier: jest.fn(),
      updateRechargeTier: jest.fn(),
      deleteRechargeTier: jest.fn(),
      cloneRechargeTier: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        RechargeTiersService,
        { provide: BillingInternalClient, useValue: billingClient },
      ],
    }).compile();

    service = module.get(RechargeTiersService);
  });

  it('lists PAYG products through billing internal API', async () => {
    billingClient.listRechargeTierProducts.mockResolvedValueOnce({
      items: [
        {
          id: 'p1',
          name: 'PAYG',
          slug: 'payg',
          billingMode: 'PAY_AS_YOU_GO',
          isActive: true,
        },
      ],
    });

    const result = await service.listPaygProducts();

    expect(result.items).toHaveLength(1);
    expect(billingClient.listRechargeTierProducts).toHaveBeenCalledWith();
  });

  it('proxies list filters to billing internal API', async () => {
    billingClient.listRechargeTiers.mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 2,
      pageSize: 30,
      totalPages: 0,
    });

    const result = await service.list({
      page: 2,
      pageSize: 30,
      productId: 'p1',
      isActive: true,
    });

    expect(result.page).toBe(2);
    expect(billingClient.listRechargeTiers).toHaveBeenCalledWith({
      page: 2,
      pageSize: 30,
      productId: 'p1',
      isActive: true,
    });
  });

  it('proxies CRUD operations to billing internal API', async () => {
    const tier = {
      id: 't1',
      productId: 'p1',
      amountCents: 1000,
      bonusType: 'FIXED' as const,
      bonusValue: 100,
      badge: null,
      sortOrder: 0,
      isActive: true,
      startAt: null,
      endAt: null,
      createdAt: '2026-05-25T00:00:00.000Z',
      updatedAt: '2026-05-25T00:00:00.000Z',
    };
    billingClient.getRechargeTier.mockResolvedValueOnce(tier);
    billingClient.createRechargeTier.mockResolvedValueOnce(tier);
    billingClient.updateRechargeTier.mockResolvedValueOnce({ ...tier, isActive: false });
    billingClient.deleteRechargeTier.mockResolvedValueOnce(null);
    billingClient.cloneRechargeTier.mockResolvedValueOnce({ ...tier, id: 't2' });

    await expect(service.getById('t1')).resolves.toMatchObject({ id: 't1' });
    await expect(service.create({
      productId: 'p1',
      amountCents: 1000,
      bonusType: 'FIXED',
      bonusValue: 100,
    })).resolves.toMatchObject({ id: 't1' });
    await expect(service.update('t1', { isActive: false })).resolves.toMatchObject({
      isActive: false,
    });
    await expect(service.softDelete('t1')).resolves.toBeUndefined();
    await expect(service.clone('t1')).resolves.toMatchObject({ id: 't2' });

    expect(billingClient.getRechargeTier).toHaveBeenCalledWith('t1');
    expect(billingClient.createRechargeTier).toHaveBeenCalledWith({
      productId: 'p1',
      amountCents: 1000,
      bonusType: 'FIXED',
      bonusValue: 100,
    });
    expect(billingClient.updateRechargeTier).toHaveBeenCalledWith('t1', {
      isActive: false,
    });
    expect(billingClient.deleteRechargeTier).toHaveBeenCalledWith('t1');
    expect(billingClient.cloneRechargeTier).toHaveBeenCalledWith('t1');
  });
});
