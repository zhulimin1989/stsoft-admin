import { test, expect } from '@playwright/test';
import { adminLogin, waitForTable, waitForModal, clickModalOk, waitForModalClose } from './helpers';

test.describe('用户管理 — 功能测试', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await page.goto('/users');
    await waitForTable(page);
  });

  test('用户状态切换：来回切换两次验证', async ({ page }) => {
    // 找到测试用户行
    const row = page.locator('tr', { hasText: 'test@iruidong.com' });
    await expect(row).toBeVisible({ timeout: 5000 });

    // 检测当前状态（状态列是第 4 列）
    const statusCell = row.locator('td').nth(3);
    const initialStatus = (await statusCell.innerText()).trim();
    const wasActive = initialStatus.includes('正常');

    // 第一次点击：切换状态，同时等 API 响应
    const [response1] = await Promise.all([
      page.waitForResponse((resp) => resp.url().includes('/toggle-status') && resp.status() < 400, { timeout: 10000 }),
      row.locator('button').nth(1).click(),
    ]);

    // 等待表格刷新
    const expectedAfterFirst = wasActive ? '停用' : '正常';
    await expect(statusCell).toContainText(expectedAfterFirst, { timeout: 5000 });

    // 第二次点击：切回原始状态
    const [response2] = await Promise.all([
      page.waitForResponse((resp) => resp.url().includes('/toggle-status') && resp.status() < 400, { timeout: 10000 }),
      row.locator('button').nth(1).click(),
    ]);

    await expect(statusCell).toContainText(initialStatus, { timeout: 5000 });
  });

  test('调额弹窗：正向充值并验证', async ({ page }) => {
    const row = page.locator('tr', { hasText: 'test@iruidong.com' });
    await expect(row).toBeVisible({ timeout: 5000 });

    // 点击"调额"按钮（第一个按钮）
    await row.locator('button').first().click();
    await waitForModal(page);

    // 验证弹窗标题包含用户邮箱
    await expect(page.locator('.ant-modal-header')).toContainText('test@iruidong.com');

    // 输入正金额
    await page.locator('.ant-modal-body .ant-input-number input').fill('500');
    // 输入说明
    await page.locator('.ant-modal-body input:not(.ant-input-number-input)').fill('E2E 功能测试充值');

    await clickModalOk(page);
    await waitForModalClose(page);
  });

  test('调额弹窗：负向扣减', async ({ page }) => {
    const row = page.locator('tr', { hasText: 'test@iruidong.com' });
    await expect(row).toBeVisible({ timeout: 5000 });

    await row.locator('button').first().click();
    await waitForModal(page);

    // 输入负金额
    await page.locator('.ant-modal-body .ant-input-number input').fill('-100');
    await page.locator('.ant-modal-body input:not(.ant-input-number-input)').fill('E2E 扣减测试');

    await clickModalOk(page);
    await waitForModalClose(page);
  });

  test('用户列表分页', async ({ page }) => {
    // 验证分页信息可见
    await expect(page.locator('.ant-pagination')).toBeVisible();
    await expect(page.getByText(/共 \d+ 条/)).toBeVisible();
  });
});
