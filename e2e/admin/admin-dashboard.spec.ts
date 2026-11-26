import { test, expect } from '@playwright/test';

test.describe('管理端 Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('admin@example.com').fill('admin@iruidong.com');
    await page.getByPlaceholder('输入密码').fill('admin123');
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('运营总览')).toBeVisible({ timeout: 10000 });
  });

  test('Dashboard 统计卡片渲染', async ({ page }) => {
    await expect(page.getByText('总用户数量')).toBeVisible();
    await expect(page.getByText('今日新增用户')).toBeVisible();
    await expect(page.getByText('今日收款')).toBeVisible();
    await expect(page.getByText('累计收款')).toBeVisible();
    await expect(page.getByText('用户增量趋势')).toBeVisible();
    await expect(page.getByText('收款趋势')).toBeVisible();
    await expect(page.getByText('按产品维度收款')).toBeVisible();
  });
});
