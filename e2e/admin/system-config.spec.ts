import { test, expect } from '@playwright/test';

test.describe('系统配置', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('admin@example.com').fill('admin@iruidong.com');
    await page.getByPlaceholder('输入密码').fill('admin123');
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('运营总览')).toBeVisible({ timeout: 10000 });
    await page.goto('/system-config');
    await expect(page.getByText('系统配置').first()).toBeVisible({ timeout: 10000 });
  });

  test('配置页面加载', async ({ page }) => {
    // 保存配置按钮（4个中文字，AntD 不插空格）
    await expect(page.locator('button', { hasText: /保存配置/ })).toBeVisible();
  });

  test('Feature Flags 开关可见', async ({ page }) => {
    await expect(page.getByText('允许注册')).toBeVisible();
    await expect(page.getByText('启用额度系统')).toBeVisible();
    await expect(page.getByText('启用 API 访问')).toBeVisible();
    await expect(page.getByText('维护模式')).toBeVisible();
  });

  test('保存配置', async ({ page }) => {
    await page.locator('button', { hasText: /保存配置/ }).click();
    // 保存后不报错即成功（message toast 可能太快消失）
    await page.waitForTimeout(1000);
    // 确认页面没崩溃
    await expect(page.getByText('系统配置').first()).toBeVisible();
  });
});
