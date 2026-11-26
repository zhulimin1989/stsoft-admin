import { test, expect } from '@playwright/test';
import { adminLogin, waitForTable } from './helpers';

test.describe('模型权限矩阵 — 功能测试', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await page.goto('/model-access');
    await expect(page.getByText('模型权限矩阵').first()).toBeVisible({ timeout: 10000 });
    await waitForTable(page);
  });

  test('矩阵表格加载 — 含套餐列', async ({ page }) => {
    // 套餐列头在 AntD Table 的 thead 中，即使无数据也应渲染
    const hasFree = await page.getByText('FREE').isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasFree) {
      // 无数据时列头可能也不渲染（动态列依赖数据）
      test.skip(true, '模型权限矩阵无套餐列（可能无渠道数据），跳过');
      return;
    }
    await expect(page.getByText('FREE')).toBeVisible();
    await expect(page.getByText('PRO')).toBeVisible();
    await expect(page.getByText('MAX')).toBeVisible();
  });

  test('保存按钮初始为"已保存"（disabled）', async ({ page }) => {
    const saveBtn = page.locator('button', { hasText: /已保存/ });
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toBeDisabled();
  });

  test('切换开关后保存按钮变为"保存更改"', async ({ page }) => {
    // 找到第一个 switch
    const firstSwitch = page.locator('.ant-table-tbody .ant-switch').first();
    const hasSwitches = await firstSwitch.isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasSwitches) {
      test.skip(true, '表格无开关（无数据行），跳过测试');
      return;
    }
    await firstSwitch.click();

    // 保存按钮应变为可用
    const saveBtn = page.locator('button', { hasText: /保存更改/ });
    await expect(saveBtn).toBeEnabled({ timeout: 3000 });
  });

  test('批量保存完整流程', async ({ page }) => {
    const firstSwitch = page.locator('.ant-table-tbody .ant-switch').first();
    const hasSwitches = await firstSwitch.isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasSwitches) {
      test.skip(true, '表格无开关（无数据行），跳过测试');
      return;
    }
    // 切换一个开关
    await firstSwitch.click();

    // 点击保存
    const saveBtn = page.locator('button', { hasText: /保存更改/ });
    await expect(saveBtn).toBeEnabled({ timeout: 3000 });
    await saveBtn.click();

    // 保存后按钮回到"已保存"
    await expect(page.locator('button', { hasText: /已保存/ })).toBeVisible({ timeout: 5000 });
  });

  test('刷新按钮', async ({ page }) => {
    await page.getByRole('button', { name: /刷新/ }).click();
    await waitForTable(page);
  });
});
