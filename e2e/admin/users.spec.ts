import { test, expect } from '@playwright/test';
import { adminLogin } from './helpers';

test.describe('用户管理', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await page.goto('/users');
    await expect(page.getByText('用户管理').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.ant-table')).toBeVisible({ timeout: 10000 });
  });

  test('用户列表加载当前信息架构', async ({ page }) => {
    await expect(page.getByText('当前结果')).toBeVisible();
    await expect(page.getByText('当前页启用用户')).toBeVisible();
    await expect(page.getByText('当前页缺少订阅（异常）')).toBeVisible();
    await expect(page.getByText('当前套餐').first()).toBeVisible();
  });

  test('用户列表展示套餐状态与引导说明', async ({ page }) => {
    await expect(page.getByText('45706780@qq.com')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('历史异常账号会在赠送积分时兜底补齐 Free 套餐').first()).toBeVisible();
    await expect(page.getByText(/Free|未分配套餐/).first()).toBeVisible();
  });

  test('可从列表进入用户详情', async ({ page }) => {
    await page.getByRole('button', { name: '查看' }).first().click();
    await expect(page.getByText('基本信息')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /赠送积分/ }).first()).toBeVisible();
    await expect(page.getByText('产品订阅')).toBeVisible();
  });
});
