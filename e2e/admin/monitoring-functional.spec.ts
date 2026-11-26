import { test, expect } from '@playwright/test';
import { adminLogin, waitForTable, waitForModal, clickModalOk, waitForModalClose, submitModalAndExpectClose } from './helpers';

test.describe('系统监控 — 功能测试', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await page.goto('/monitoring');
    await expect(page.getByText('系统监控').first()).toBeVisible({ timeout: 10000 });
  });

  test('渠道健康 Tab 加载', async ({ page }) => {
    // 默认在"渠道健康"Tab
    await expect(page.getByText('渠道健康')).toBeVisible();
    await expect(page.locator('.ant-table')).toBeVisible({ timeout: 10000 });

    // 表头验证
    await expect(page.getByText('渠道名称').first()).toBeVisible();
    await expect(page.getByText('提供商').first()).toBeVisible();
    await expect(page.getByText('成功率').first()).toBeVisible();
  });

  test('切换到告警规则 Tab', async ({ page }) => {
    // 点击"告警规则"Tab
    await page.locator('.ant-tabs-tab', { hasText: '告警规则' }).click();

    // 验证告警规则内容可见
    await expect(page.getByRole('button', { name: /新增规则/ })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('规则名称').first()).toBeVisible();
  });

  test('创建告警规则完整流程', async ({ page }) => {
    // 切到告警规则 Tab
    await page.locator('.ant-tabs-tab', { hasText: '告警规则' }).click();
    await expect(page.getByRole('button', { name: /新增规则/ })).toBeVisible({ timeout: 5000 });

    const ruleName = `E2E-Alert-${Date.now()}`;
    await page.getByRole('button', { name: /新增规则/ }).click();
    await waitForModal(page);

    // 填写表单
    await page.getByPlaceholder('如: OpenAI 错误率告警').fill(ruleName);

    // 选择监控指标
    const modal = page.locator('.ant-modal-body');
    await modal.locator('.ant-form-item', { hasText: '监控指标' }).locator('.ant-select').click();
    await page.locator('.ant-select-item-option', { hasText: '错误率' }).click();

    // 选择条件
    await modal.locator('.ant-form-item', { hasText: '条件' }).locator('.ant-select').click();
    await page.locator('.ant-select-item-option').filter({ hasText: /^大于$/ }).click();

    // 阈值
    await page.getByPlaceholder('如 0.1').fill('0.5');

    // 时间窗口（默认已设为 5m，保持）

    await submitModalAndExpectClose(page);

    // 验证新规则出现
    await expect(page.getByText(ruleName)).toBeVisible({ timeout: 5000 });
  });

  test('告警规则状态切换', async ({ page }) => {
    await page.locator('.ant-tabs-tab', { hasText: '告警规则' }).click();
    await page.waitForTimeout(1000);

    const alertSwitch = page.locator('.ant-table-tbody .ant-switch').first();
    if (await alertSwitch.isVisible({ timeout: 3000 }).catch(() => false)) {
      const wasChecked = await alertSwitch.getAttribute('aria-checked') === 'true';
      await alertSwitch.click();
      await page.waitForTimeout(1000);
      const nowChecked = await alertSwitch.getAttribute('aria-checked') === 'true';
      expect(nowChecked).not.toBe(wasChecked);

      // 恢复
      await alertSwitch.click();
      await page.waitForTimeout(1000);
    }
  });

  test('渠道健康刷新按钮', async ({ page }) => {
    await page.getByRole('button', { name: /刷新/ }).first().click();
    await expect(page.locator('.ant-table')).toBeVisible({ timeout: 10000 });
  });
});
