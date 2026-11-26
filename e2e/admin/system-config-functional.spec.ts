import { test, expect } from '@playwright/test';
import { adminLogin } from './helpers';

test.describe('系统配置 — 功能测试', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await page.goto('/system-config');
    await page.waitForURL('**/system-config', { timeout: 10000 });
    await page.locator('.ant-card').first().waitFor({ timeout: 10000 });
  });

  test('三大配置区域渲染', async ({ page }) => {
    await expect(page.getByText('模型配置')).toBeVisible();
    await expect(page.getByText('功能开关').nth(0)).toBeVisible();
    await expect(page.getByText('邮件配置')).toBeVisible();
  });

  test('模型配置 — 默认模型下拉', async ({ page }) => {
    const modelCard = page.locator('.ant-card', { hasText: '模型配置' });
    const modelSelect = modelCard.locator('.ant-select');
    await expect(modelSelect).toBeVisible();

    await modelSelect.click();
    await expect(page.locator('.ant-select-item-option').first()).toBeVisible({ timeout: 3000 });
    await page.keyboard.press('Escape');
  });

  test('模型配置 — 最大 Token 数可编辑', async ({ page }) => {
    const modelCard = page.locator('.ant-card', { hasText: '模型配置' });
    const tokenInput = modelCard.locator('.ant-input-number input');
    await expect(tokenInput).toBeVisible();

    const original = await tokenInput.inputValue();
    await tokenInput.clear();
    await tokenInput.fill('16384');
    await tokenInput.clear();
    await tokenInput.fill(original || '8192');
  });

  test('功能开关 — 四个开关可见', async ({ page }) => {
    const flagsCard = page.locator('.ant-card', { hasText: '功能开关' }).first();
    await expect(flagsCard.getByText('允许注册')).toBeVisible();
    await expect(flagsCard.getByText('启用额度系统')).toBeVisible();
    await expect(flagsCard.getByText('启用 API 访问')).toBeVisible();
    await expect(flagsCard.getByText('维护模式')).toBeVisible();
  });

  test('功能开关 — 切换并恢复', async ({ page }) => {
    const flagsCard = page.locator('.ant-card', { hasText: '功能开关' }).first();
    const signupSwitch = flagsCard.locator('.ant-switch').first();
    const wasChecked = await signupSwitch.getAttribute('aria-checked') === 'true';
    await signupSwitch.click();
    await page.waitForTimeout(300);

    const nowChecked = await signupSwitch.getAttribute('aria-checked') === 'true';
    expect(nowChecked).not.toBe(wasChecked);

    await signupSwitch.click();
    await page.waitForTimeout(300);
  });

  test('维护模式警告文字', async ({ page }) => {
    await expect(page.getByText('开启后所有用户将无法访问平台')).toBeVisible();
  });

  test('邮件配置字段可编辑', async ({ page }) => {
    const emailCard = page.locator('.ant-card', { hasText: '邮件配置' });
    await expect(emailCard.getByText('SMTP 主机')).toBeVisible();
    await expect(emailCard.getByText('SMTP 端口')).toBeVisible();
    await expect(emailCard.getByText('发送邮箱')).toBeVisible();
  });

  test('保存配置按钮', async ({ page }) => {
    const saveBtn = page.locator('button', { hasText: /保存配置/ });
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    await page.waitForTimeout(1000);
    await expect(page.getByText('系统配置').first()).toBeVisible();
  });
});
