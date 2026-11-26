import { test, expect } from '@playwright/test';
import { adminLogin, waitForTable, waitForModal, clickModalOk, waitForModalClose, submitModalAndExpectClose } from './helpers';

test.describe('公告管理 — 功能测试', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await page.goto('/announcements');
    await expect(page.getByText('公告管理').first()).toBeVisible({ timeout: 10000 });
  });

  test('创建公告完整流程', async ({ page }) => {
    const title = `E2E 公告 ${Date.now()}`;
    await page.getByRole('button', { name: /新增公告/ }).click();
    await waitForModal(page);

    // 验证弹窗标题
    await expect(page.locator('.ant-modal-header')).toContainText('新增公告');

    // 填写标题
    await page.getByPlaceholder('公告标题').fill(title);
    // 填写内容
    await page.getByPlaceholder('公告内容').fill('这是一条 E2E 测试公告，用于验证公告创建功能正常工作。');

    // 选择类型
    const modal = page.locator('.ant-modal-body');
    await modal.locator('.ant-form-item', { hasText: '类型' }).locator('.ant-select').click();
    await page.locator('.ant-select-item-option', { hasText: '通知' }).click();

    // 选择目标受众
    await modal.locator('.ant-form-item', { hasText: '目标受众' }).locator('.ant-select').click();
    await page.locator('.ant-select-item-option', { hasText: '所有用户' }).click();

    // 点击"发布"
    await submitModalAndExpectClose(page);

    // 验证新公告出现在列表
    await expect(page.getByText(title)).toBeVisible({ timeout: 5000 });
  });

  test('公告状态切换（启用/禁用）', async ({ page }) => {
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

  test('刷新按钮', async ({ page }) => {
    await page.getByRole('button', { name: /刷新/ }).click();
    // 页面不崩溃
    await expect(page.getByText('公告管理').first()).toBeVisible({ timeout: 5000 });
  });

  test('公告数量统计显示', async ({ page }) => {
    // "共 N 条公告" 文字可见
    await expect(page.getByText(/共 \d+ 条公告/)).toBeVisible({ timeout: 5000 });
  });
});
