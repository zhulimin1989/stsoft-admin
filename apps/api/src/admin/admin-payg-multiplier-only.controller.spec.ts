import { PATH_METADATA } from '@nestjs/common/constants';
import { ADMIN_PERMISSION_KEY } from '../common/decorators/admin-permission.decorator';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

/**
 * 按量定价「倍率-only」：绝对覆盖价已废除（设计稿 §1.3 / §1.5b）。
 *
 * 这里验证的是**代理入口**这一道闸：它必须在把请求交给 billing 之前就拒掉四个已废除字段，
 * 否则在「admin 已发布、billing 未滚完」的窗口内，旧 billing 会把空白字符串按 Number('   ')===0
 * 落库成零覆盖价。生产上该接口有权限守卫（未鉴权探测只会拿到 403），所以这道校验只能用
 * 控制器级测试来证明。
 */
describe('AdminController - PAYG 倍率-only 写侧', () => {
  const overrideFields = [
    'inputPricePerMToken',
    'cachedInputPrice',
    'cacheWritePrice',
    'outputPricePerMToken',
  ] as const;

  function buildController() {
    const service = {
      createPaygModelPricingVersion: jest.fn().mockResolvedValue({ id: 'policy-1' }),
    } as unknown as jest.Mocked<Pick<AdminService, 'createPaygModelPricingVersion'>>;
    const controller = new AdminController(service as unknown as AdminService);
    return { controller, service };
  }

  it('路由与权限保持不变', () => {
    const path = Reflect.getMetadata(
      PATH_METADATA,
      AdminController.prototype.createPaygModelPricingVersion,
    );
    const permissions = Reflect.getMetadata(
      ADMIN_PERMISSION_KEY,
      AdminController.prototype.createPaygModelPricingVersion,
    );

    expect(path).toBe('payg-model-pricing');
    expect(permissions).toEqual(['admin.page.payg_pricing.manage']);
  });

  it.each(overrideFields)('带 %s 的非空覆盖价 ⇒ 400，且不下发到 billing', async (field) => {
    const { controller, service } = buildController();

    await expect(
      controller.createPaygModelPricingVersion({
        productId: 'prod-payg',
        modelName: 'gpt-4o',
        priceMultiplier: '0.9',
        [field]: '7',
      } as never),
    ).rejects.toMatchObject({ status: 400 });

    expect(service.createPaygModelPricingVersion).not.toHaveBeenCalled();
  });

  it('null / undefined / 空白字符串视为未配置 ⇒ 放行，且四字段不转发', async () => {
    const { controller, service } = buildController();

    const result = await controller.createPaygModelPricingVersion({
      productId: 'prod-payg',
      modelName: 'gpt-4o',
      priceMultiplier: '0.9',
      inputPricePerMToken: null,
      cachedInputPrice: undefined,
      cacheWritePrice: '   ',
      outputPricePerMToken: '',
    } as never);

    expect(result).toEqual({ code: 0, message: '保存成功', data: { id: 'policy-1' } });
    expect(service.createPaygModelPricingVersion).toHaveBeenCalledTimes(1);
    const forwarded = service.createPaygModelPricingVersion.mock.calls[0][0] as Record<string, unknown>;
    for (const field of overrideFields) {
      expect(forwarded).not.toHaveProperty(field);
    }
    expect(forwarded).toMatchObject({ productId: 'prod-payg', modelName: 'gpt-4o', priceMultiplier: '0.9' });
  });
});
