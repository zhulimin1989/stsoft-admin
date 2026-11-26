import { test, expect } from '@playwright/test';

test.describe('渠道管理', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('admin@example.com').fill('admin@iruidong.com');
    await page.getByPlaceholder('输入密码').fill('admin123');
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('运营总览')).toBeVisible({ timeout: 10000 });
    await page.goto('/channels');
    await expect(page.getByText('渠道管理').first()).toBeVisible({ timeout: 10000 });
  });

  test('渠道列表加载', async ({ page }) => {
    await expect(page.getByText('名称').first()).toBeVisible();
    await expect(page.getByText('供应商').first()).toBeVisible();
  });

  test('新增渠道弹窗', async ({ page }) => {
    await page.getByRole('button', { name: /新增渠道/ }).click();
    await expect(page.getByPlaceholder('如：OpenAI 主力')).toBeVisible();
    await expect(page.getByPlaceholder('https://api.openai.com/v1')).toBeVisible();
    // AntD 按钮空格问题，用 CSS 选择器关闭弹窗
    await page.locator('.ant-modal-footer button:not(.ant-btn-primary)').click();
    await expect(page.locator('.ant-modal')).toBeHidden({ timeout: 3000 });
  });

  test('创建渠道完整流程', async ({ page }) => {
    await page.getByRole('button', { name: /新增渠道/ }).click();
    await expect(page.getByPlaceholder('如：OpenAI 主力')).toBeVisible();

    const name = `E2E-Channel-${Date.now()}`;
    await page.getByPlaceholder('如：OpenAI 主力').fill(name);
    await page.locator('.ant-modal .ant-select').first().click();
    await page.locator('.ant-select-item-option', { hasText: 'DeepSeek' }).click();
    await page.getByPlaceholder('https://api.openai.com/v1').fill('https://api.deepseek.com/v1');
    await page.getByPlaceholder('sk-...').fill('sk-test-fake-key');

    await page.locator('.ant-modal-footer button.ant-btn-primary').click();
    // 弹窗关闭 = 创建成功
    await expect(page.locator('.ant-modal')).toBeHidden({ timeout: 5000 });
    await expect(page.getByText(name)).toBeVisible();
  });
});
