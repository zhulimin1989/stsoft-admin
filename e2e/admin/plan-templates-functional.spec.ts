import { test, expect } from '@playwright/test';
import { adminLogin, waitForTable, waitForModal, clickModalOk, waitForModalClose, submitModalAndExpectClose } from './helpers';

test.describe('套餐模板 — 功能测试', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await page.goto('/plan-templates');
    await expect(page.getByText('套餐模板').first()).toBeVisible({ timeout: 10000 });
    await waitForTable(page);
  });

  test('种子套餐数据展示', async ({ page }) => {
    // 验证种子数据中的套餐可见
    await expect(page.getByText('体验版').first()).toBeVisible({ timeout: 5000 });
  });

  test('创建新套餐完整流程', async ({ page }) => {
    const planId = `e2e-plan-${Date.now()}`;
    await page.getByRole('button', { name: /新增套餐/ }).click();
    await waitForModal(page);

    // 验证弹窗标题
    await expect(page.locator('.ant-modal-header')).toContainText('新增套餐');

    // 填写表单 — 用 Form.Item label 定位，避免 placeholder 冲突
    const modal = page.locator('.ant-modal-body');
    await modal.locator('.ant-form-item', { hasText: '套餐ID' }).locator('input').fill(planId);
    await modal.locator('.ant-form-item', { hasText: '套餐名称' }).locator('input').fill('E2E 测试套餐');

    // 填写数字字段 — 定位到 Form.Item label 后面的 InputNumber
    // 月度额度
    await modal.locator('.ant-form-item', { hasText: '月度额度' }).locator('input').fill('50000');
    // 月费价格
    await modal.locator('.ant-form-item', { hasText: '月费价格' }).locator('input').fill('9900');
    // 年费折算月价
    await modal.locator('.ant-form-item', { hasText: '年费折算月价' }).locator('input').fill('7900');
    // 成员上限
    await modal.locator('.ant-form-item', { hasText: '成员上限' }).locator('input').fill('10');
    // 存储上限
    await modal.locator('.ant-form-item', { hasText: '存储上限' }).locator('input').fill('50');
    // API 调用上限
    await modal.locator('.ant-form-item', { hasText: 'API 调用上限' }).locator('input').fill('100000');

    // 功能描述
    await modal.locator('textarea').fill('高级代码分析\n优先客服支持\n自定义模型');

    // 是否启用开关（默认 true，保持）
    await submitModalAndExpectClose(page);

    // 验证新套餐出现在列表（可能有多个同名，用 first）
    await expect(page.getByText('E2E 测试套餐').first()).toBeVisible({ timeout: 5000 });
  });

  test('编辑现有套餐', async ({ page }) => {
    // 点击第一个数据行的编辑按钮（排除 measure-row）
    const firstRow = page.locator('.ant-table-tbody tr:not(.ant-table-measure-row)').first();
    await expect(firstRow).toBeVisible({ timeout: 5000 });
    await firstRow.getByRole('button', { name: /编辑/ }).click();
    await waitForModal(page);

    // 验证弹窗标题
    await expect(page.locator('.ant-modal-header')).toContainText('编辑套餐');

    // 套餐ID 应不可编辑 — 用 Form.Item label 定位
    const modal = page.locator('.ant-modal-body');
    const idInput = modal.locator('.ant-form-item', { hasText: '套餐ID' }).locator('input');
    await expect(idInput).toBeDisabled();

    // 修改名称
    const nameInput = modal.locator('.ant-form-item', { hasText: '套餐名称' }).locator('input');
    const originalName = await nameInput.inputValue();
    await nameInput.clear();
    await nameInput.fill(originalName); // 改回原名保持数据稳定

    await submitModalAndExpectClose(page);
  });

  test('刷新按钮', async ({ page }) => {
    await page.getByRole('button', { name: /刷新/ }).click();
    // 表格仍然可见
    await waitForTable(page);
  });
});
