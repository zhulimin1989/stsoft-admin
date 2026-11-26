import { test, expect } from '@playwright/test';

const adminEmail = process.env.ADMIN_EMAIL || 'admin@iruidong.com';
const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

test.describe('管理员认证', () => {
  test('管理员登录页渲染', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('睿动 · 管理后台')).toBeVisible();
    await expect(page.getByText('管理员登录')).toBeVisible();
  });

  test('管理员登录成功', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('admin@example.com').fill(adminEmail);
    await page.getByPlaceholder('输入密码').fill(adminPassword);
    await page.locator('button[type="submit"]').click();

    await expect(page.getByText('运营总览')).toBeVisible({ timeout: 10000 });
  });

  test('未登录跳转到登录页', async ({ page }) => {
    await page.goto('/users');
    await page.waitForURL(/\/login/, { timeout: 5000 });
  });
});
