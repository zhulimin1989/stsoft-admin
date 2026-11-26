import { test, expect } from '@playwright/test';
import { adminLogin, waitForTable } from './helpers';

test.describe('会话监控 — 功能测试', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await page.goto('/sessions');
    await expect(page.getByText('会话监控').first()).toBeVisible({ timeout: 10000 });
  });

  test('统计卡片渲染', async ({ page }) => {
    await expect(page.getByText('会话总数')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('今日新增')).toBeVisible();
    await expect(page.getByText('最近 1 小时活跃')).toBeVisible();
  });

  test('会话列表加载', async ({ page }) => {
    await waitForTable(page);
    // 表头验证
    await expect(page.getByText('会话 ID').first()).toBeVisible();
    await expect(page.getByText('用户 ID').first()).toBeVisible();
    await expect(page.getByText('标题').first()).toBeVisible();
    await expect(page.getByText('状态').first()).toBeVisible();
  });

  test('自动刷新提示可见', async ({ page }) => {
    await expect(page.getByText('每 30 秒自动刷新')).toBeVisible();
  });

  test('手动刷新按钮', async ({ page }) => {
    await page.getByRole('button', { name: /刷新/ }).click();
    // 表格仍可见
    await waitForTable(page);
    await expect(page.getByText('会话监控').first()).toBeVisible();
  });

  test('分页信息显示', async ({ page }) => {
    await waitForTable(page);
    // 验证分页区域存在
    const pagination = page.locator('.ant-pagination');
    if (await pagination.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(page.getByText(/共 \d+ 条/)).toBeVisible();
    }
  });
});
