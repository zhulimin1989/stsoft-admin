import { test, expect } from '@playwright/test';
import { adminLogin, waitForTable, waitForModal, clickModalOk, waitForModalClose } from './helpers';

test.describe('功能开关 — 功能测试', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await page.goto('/feature-flags');
    await expect(page.getByText('功能开关').first()).toBeVisible({ timeout: 10000 });
  });

  test('创建全局功能开关', async ({ page }) => {
    const key = `e2e_flag_${Date.now()}`;
    await page.getByRole('button', { name: /新增开关/ }).click();
    await waitForModal(page);

    // 验证弹窗标题
    await expect(page.locator('.ant-modal-header')).toContainText('新增功能开关');

    // 填写 Key
    await page.getByPlaceholder('如: enable_new_chat_ui').fill(key);
    // 描述
    await page.getByPlaceholder('功能描述').fill('E2E 测试功能开关');
    // 默认值保持关（false）
    // 作用域默认为"全局"

    await clickModalOk(page);
    await waitForModalClose(page);

    // 验证新开关出现
    await expect(page.getByText(key)).toBeVisible({ timeout: 5000 });
  });

  test('创建套餐级别开关（条件字段展示）', async ({ page }) => {
    const key = `e2e_tier_flag_${Date.now()}`;
    await page.getByRole('button', { name: /新增开关/ }).click();
    await waitForModal(page);

    await page.getByPlaceholder('如: enable_new_chat_ui').fill(key);
    await page.getByPlaceholder('功能描述').fill('E2E 套餐级开关测试');

    // 选择作用域为"套餐"
    const modal = page.locator('.ant-modal-body');
    await modal.locator('.ant-form-item', { hasText: '作用域' }).locator('.ant-select').click();
    await page.locator('.ant-select-item-option', { hasText: '套餐' }).click();

    // 条件字段"作用对象"应出现
    await expect(page.getByPlaceholder('如套餐 ID / 用户 ID')).toBeVisible({ timeout: 3000 });
    await page.getByPlaceholder('如套餐 ID / 用户 ID').fill('pro');

    await clickModalOk(page);
    await waitForModalClose(page);

    await expect(page.getByText(key)).toBeVisible({ timeout: 5000 });
  });

  test('功能开关状态切换（开/关）', async ({ page }) => {
    await waitForTable(page);

    const firstSwitch = page.locator('.ant-table-tbody .ant-switch').first();
    if (await firstSwitch.isVisible({ timeout: 3000 }).catch(() => false)) {
      const wasChecked = await firstSwitch.getAttribute('aria-checked') === 'true';
      await firstSwitch.click();
      await page.waitForTimeout(1000);

      const nowChecked = await firstSwitch.getAttribute('aria-checked') === 'true';
      expect(nowChecked).not.toBe(wasChecked);

      // 恢复
      await firstSwitch.click();
      await page.waitForTimeout(1000);
    }
  });

  test('编辑功能开关', async ({ page }) => {
    await waitForTable(page);

    // 点击第一行的编辑按钮
    const firstRow = page.locator('.ant-table-tbody tr').first();
    if (await firstRow.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstRow.getByRole('button', { name: /编辑/ }).click();
      await waitForModal(page);

      // 验证弹窗标题
      await expect(page.locator('.ant-modal-header')).toContainText('编辑功能开关');

      // Key 应不可编辑
      const keyInput = page.locator('.ant-modal-body').getByPlaceholder('如: enable_new_chat_ui');
      await expect(keyInput).toBeDisabled();

      // 修改描述
      const descInput = page.locator('.ant-modal-body').getByPlaceholder('功能描述');
      const original = await descInput.inputValue();
      await descInput.clear();
      await descInput.fill(original || 'E2E 编辑测试');

      await clickModalOk(page);
      await waitForModalClose(page);
    }
  });

  test('刷新按钮', async ({ page }) => {
    await page.getByRole('button', { name: /刷新/ }).click();
    await expect(page.getByText('功能开关').first()).toBeVisible({ timeout: 5000 });
  });
});
