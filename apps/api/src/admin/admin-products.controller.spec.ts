import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

describe('AdminController - Products', () => {
  const paymentCallbackPolicies: Array<[string, string[] | null]> = [
    ['global fallback', null],
    ['deny all', []],
    ['product allowlist', ['https://app.example.com']],
  ];

  it.each(paymentCallbackPolicies)(
    'passes the %s payment callback policy through unchanged',
    async (_label, policy) => {
      const product = { id: 'product-1', allowedPaymentCallbackOrigins: policy };
      const service = {
        updateProduct: jest.fn().mockResolvedValue(product),
      } as unknown as jest.Mocked<Pick<AdminService, 'updateProduct'>>;
      const controller = new AdminController(service as unknown as AdminService);

      await expect(controller.updateProduct('product-1', {
        allowedPaymentCallbackOrigins: policy,
      })).resolves.toEqual({
        code: 0,
        message: '更新成功',
        data: product,
      });

      expect(service.updateProduct).toHaveBeenCalledWith('product-1', {
        allowedPaymentCallbackOrigins: policy,
      });
    },
  );
});
