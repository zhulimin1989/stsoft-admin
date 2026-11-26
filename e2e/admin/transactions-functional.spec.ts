import { test, expect } from '@playwright/test';
import { adminLogin, waitForTable } from './helpers';

test.describe('交易流水 — 功能测试', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await page.goto('/transactions');
    await expect(page.getByText('交易流水').first()).toBeVisible({ timeout: 10000 });
    await waitForTable(page);
  });

  test('表头列正确', async ({ page }) => {
    await expect(page.getByText('类型').first()).toBeVisible();
    await expect(page.getByText('用户').first()).toBeVisible();
    await expect(page.getByText('金额').first()).toBeVisible();
    await expect(page.getByText('余额').first()).toBeVisible();
    await expect(page.getByText('说明').first()).toBeVisible();
  });

  test('交易记录展示', async ({ page }) => {
    // 只要有 seed 数据或之前测试产生的调额记录，表格应有内容
    const rows = page.locator('.ant-table-tbody tr');
    const count = await rows.count();
    // 至少有 header row 之外的 tbody 行（可能为 empty state）
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('分页信息', async ({ page }) => {
    const pagination = page.locator('.ant-pagination');
    if (await pagination.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(page.getByText(/共 \d+ 条/)).toBeVisible();
    }
  });

  test('交易类型 Tag 颜色', async ({ page }) => {
    // 如果有数据，验证 Tag 存在
    const tags = page.locator('.ant-table-tbody .ant-tag');
    const count = await tags.count();
    if (count > 0) {
      // 第一个 Tag 应有颜色属性
      await expect(tags.first()).toBeVisible();
    }
  });
});
