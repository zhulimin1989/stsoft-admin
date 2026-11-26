import { test, expect } from '@playwright/test';
import { adminLogin } from './helpers';

test.describe('营收概览 — 功能测试', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await page.goto('/revenue');
    // Revenue 页可能 loading 较慢
    await page.waitForTimeout(2000);
  });

  test('统计卡片渲染', async ({ page }) => {
    // 4 张统计卡
    await expect(page.getByText('总消耗额度')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('活跃用户')).toBeVisible();
    await expect(page.getByText('MRR')).toBeVisible();
    await expect(page.getByText('ARPU')).toBeVisible();
  });

  test('图表区域渲染', async ({ page }) => {
    // 两张图表的 Card title
    await expect(page.getByText('模型使用分布')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('套餐分布')).toBeVisible();
  });

  test('页面不崩溃 — 无 500 错误', async ({ page }) => {
    // 页面至少有标题
    await expect(page.getByText('营收概览').first()).toBeVisible({ timeout: 10000 });
  });
});
