import { ConfigService } from '@nestjs/config';
import { AdminService } from './admin.service';

function createService() {
  const userClient = {
    listUsers: jest.fn().mockResolvedValue({ items: [], total: 42 }),
    getUserStats: jest.fn().mockResolvedValue({
      totalUsers: 42,
      todayNewUsers: 3,
      trends: {
        sevenDays: [{ date: '06-13', value: 3 }],
        month: [{ date: '06-13', value: 3 }],
        year: [{ date: '06月', value: 12 }],
      },
      generatedAt: '2026-06-13T08:00:00.000Z',
    }),
  };
  const billingClient = {
    getRevenue: jest.fn(async (productId?: string) => {
      if (productId === 'product-a') {
        return { totalRechargeCents: 1000, todayRechargeCents: 200 };
      }
      if (productId === 'product-b') {
        return { totalRechargeCents: 3000, todayRechargeCents: 500 };
      }
      return { totalRechargeCents: 4000, todayRechargeCents: 700 };
    }),
    getRevenueOverview: jest.fn().mockResolvedValue({
      daily: [
        { date: '2026-06-12', recharge: 500 },
        { date: '2026-06-13', recharge: 700 },
      ],
      totalRechargeCents: 4000,
    }),
    listProducts: jest.fn().mockResolvedValue([
      { id: 'product-a', name: 'Product A', slug: 'a', billingMode: 'PAYG', isActive: true },
      { id: 'product-b', name: 'Product B', slug: 'b', billingMode: 'SUBSCRIPTION', isActive: true },
    ]),
  };
  const config = {
    getOrThrow: jest.fn().mockReturnValue('test-secret'),
  } as unknown as ConfigService;
  const service = new AdminService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    config,
    {} as never,
    userClient as never,
    billingClient as never,
    {} as never,
  );
  return { service, userClient, billingClient };
}

describe('AdminService dashboard overview', () => {
  const now = new Date('2026-06-13T08:00:00.000Z');

  afterEach(() => {
    jest.useRealTimers();
  });

  it('combines user stats, revenue trends, and product revenue breakdown', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    const { service, userClient, billingClient } = createService();

    const result = await service.getDashboardOverview();

    expect(userClient.getUserStats).toHaveBeenCalledTimes(1);
    expect(result.users).toMatchObject({
      totalUsers: 42,
      todayNewUsers: 3,
    });
    expect(result.payments).toMatchObject({
      available: true,
      todayRevenueCents: 700,
      totalRevenueCents: 4000,
    });
    expect(result.payments.trends.sevenDays).toContainEqual({ date: '06-12', value: 500 });
    expect(result.payments.trends.sevenDays).toContainEqual({ date: '06-13', value: 700 });
    expect(result.payments.productBreakdown[0]).toMatchObject({
      productId: 'product-b',
      totalRevenueCents: 3000,
    });
    expect(billingClient.getRevenueOverview).toHaveBeenCalledWith(7);
    expect(billingClient.getRevenue).toHaveBeenCalledWith('product-a');
    expect(billingClient.getRevenue).toHaveBeenCalledWith('product-b');
  });

  it('keeps the dashboard available when the user stats endpoint is unavailable', async () => {
    const { service, userClient } = createService();
    userClient.getUserStats.mockRejectedValueOnce(new Error('Not Found'));
    userClient.listUsers.mockResolvedValueOnce({ items: [], total: 99 });

    const result = await service.getDashboardOverview();

    expect(userClient.listUsers).toHaveBeenCalledWith(1, 1);
    expect(result.users).toMatchObject({
      available: false,
      totalUsers: 99,
      todayNewUsers: 0,
      generatedAt: null,
    });
    expect(result.users.trends).toEqual({
      sevenDays: [],
      month: [],
      year: [],
    });
  });
});
