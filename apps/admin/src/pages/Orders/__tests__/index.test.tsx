import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OrdersPage from '../index';

const mocks = vi.hoisted(() => ({
  listOrders: vi.fn(),
  getOrderDetail: vi.fn(),
  refundOrder: vi.fn(),
  cancelOrder: vi.fn(),
  retryOrder: vi.fn(),
}));

vi.mock('../../../api/admin', () => ({
  orderAdminApi: {
    list: mocks.listOrders,
    getDetail: mocks.getOrderDetail,
    refund: mocks.refundOrder,
    cancel: mocks.cancelOrder,
    retry: mocks.retryOrder,
  },
}));

vi.mock('../../../hooks/usePermission', () => ({
  usePermission: () => true,
}));

const subscriptionOrder = {
  id: 'order-subscription-1',
  userId: 'user-1',
  orderType: 'SUBSCRIPTION',
  plan: { id: 'plan-1', name: '专业套餐' },
  amountCents: 9900,
  currency: 'CNY',
  status: 'COMPLETED',
  channel: 'WECHAT',
  paidAt: '2026-08-17T02:00:00.000Z',
  completedAt: '2026-08-17T02:01:00.000Z',
  createdAt: '2026-08-17T01:59:00.000Z',
};

const codingPlanOrder = {
  ...subscriptionOrder,
  id: 'order-coding-plan-1',
  codingPlanFulfillmentMode: 'platform_model_package',
  product: {
    id: 'product-coding-plan-1',
    name: 'Coding Plan',
    billingMode: 'CODING_PLAN',
    codingPlanFulfillmentMode: 'platform_model_package',
  },
};

const providerResaleCodingPlanOrder = {
  ...codingPlanOrder,
  id: 'order-provider-resale-1',
  codingPlanFulfillmentMode: 'provider_resale',
  product: {
    ...codingPlanOrder.product,
    codingPlanFulfillmentMode: 'platform_model_package',
  },
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/orders']}>
      <OrdersPage />
    </MemoryRouter>,
  );
}

describe('OrdersPage subscription refund', () => {
  beforeEach(() => {
    mocks.listOrders.mockReset();
    mocks.getOrderDetail.mockReset();
    mocks.refundOrder.mockReset();
    mocks.cancelOrder.mockReset();
    mocks.retryOrder.mockReset();

    mocks.listOrders.mockResolvedValue({
      items: [subscriptionOrder],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    mocks.refundOrder.mockResolvedValue({});
  });

  it('opens the refund dialog and submits a subscription order refund', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /退款/ }));

    expect(await screen.findByRole('dialog', { name: '确认退款' })).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('请输入退款原因'), '客户申请退款');
    await user.click(screen.getByRole('button', { name: '确认退款' }));

    await waitFor(() => {
      expect(mocks.refundOrder).toHaveBeenCalledWith('order-subscription-1', '客户申请退款');
    });
  }, 20000);

  it('submits an unused self-operated Coding Plan refund', async () => {
    mocks.listOrders.mockResolvedValue({
      items: [codingPlanOrder],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /退款/ }));

    expect(await screen.findByRole('dialog', { name: '确认退款' })).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('请输入退款原因'), '自营套餐未使用');
    await user.click(screen.getByRole('button', { name: '确认退款' }));

    await waitFor(() => {
      expect(mocks.refundOrder).toHaveBeenCalledWith(
        'order-coding-plan-1',
        '自营套餐未使用',
      );
    });
  }, 20000);

  it('explains why provider-resale Coding Plans require manual handling', async () => {
    mocks.listOrders.mockResolvedValue({
      items: [providerResaleCodingPlanOrder],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /退款/ }));

    expect(await screen.findByRole('dialog', { name: '供应商转售套餐退款处理' })).toBeInTheDocument();
    expect(screen.getByText('供应商转售套餐需人工处理')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '需人工处理' })).toBeDisabled();
    expect(mocks.refundOrder).not.toHaveBeenCalled();
  }, 20000);

  it('keeps the dialog open and surfaces the billing rejection reason', async () => {
    mocks.refundOrder.mockRejectedValue({
      response: {
        data: {
          message: '该订单已有退款恢复任务，请等待自动恢复或查询退款结果',
        },
      },
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /退款/ }));
    await user.type(screen.getByPlaceholderText('请输入退款原因'), '客户申请退款');
    await user.click(screen.getByRole('button', { name: '确认退款' }));

    expect(await screen.findByText('退款未提交成功')).toBeInTheDocument();
    expect(screen.getByText('该订单已有退款恢复任务，请等待自动恢复或查询退款结果')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '确认退款' })).toBeInTheDocument();
  }, 20000);
});
