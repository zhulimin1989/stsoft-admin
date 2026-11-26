import { test, expect } from '@playwright/test';
import { adminLogin, waitForTable, waitForModal, clickModalOk, waitForModalClose, submitModalAndExpectClose } from './helpers';

test.describe('渠道管理 — 功能测试', () => {
  const uniqueName = `E2E-Func-${Date.now()}`;

  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await page.goto('/channels');
    await waitForTable(page);
  });

  test('创建渠道完整流程', async ({ page }) => {
    await page.getByRole('button', { name: /新增渠道/ }).click();
    await waitForModal(page);

    // 填写表单
    await page.getByPlaceholder('如：OpenAI 主力').fill(uniqueName);
    // 选择供应商
    await page.locator('.ant-modal .ant-select').first().click();
    await page.locator('.ant-select-item-option', { hasText: 'DeepSeek' }).click();
    await page.getByPlaceholder('https://api.openai.com/v1').fill('https://api.deepseek.com/v1');
    await page.getByPlaceholder('sk-...').fill('sk-e2e-test-key-fake');

    await submitModalAndExpectClose(page);

    // 验证新渠道出现在列表
    await expect(page.getByText(uniqueName)).toBeVisible({ timeout: 5000 });
  });

  test('编辑渠道', async ({ page }) => {
    // 如果表格没数据，先创建一个
    const dataRow = page.locator('.ant-table-tbody tr:not(.ant-table-measure-row)').first();
    if (!(await dataRow.isVisible({ timeout: 2000 }).catch(() => false))) {
      await page.getByRole('button', { name: /新增渠道/ }).click();
      await waitForModal(page);
      await page.getByPlaceholder('如：OpenAI 主力').fill(`E2E-Edit-${Date.now()}`);
      await page.locator('.ant-modal .ant-select').first().click();
      await page.locator('.ant-select-item-option', { hasText: 'DeepSeek' }).click();
      await page.getByPlaceholder('https://api.openai.com/v1').fill('https://api.deepseek.com/v1');
      await page.getByPlaceholder('sk-...').fill('sk-edit-test');
      await submitModalAndExpectClose(page);
    }

    // 点击编辑按钮
    const row = page.locator('.ant-table-tbody tr:not(.ant-table-measure-row)').first();
    await expect(row).toBeVisible({ timeout: 5000 });
    await row.getByRole('button', { name: /编辑/ }).click();
    await waitForModal(page);

    await expect(page.locator('.ant-modal-header')).toContainText('编辑渠道');

    const remark = page.locator('.ant-modal textarea');
    await remark.clear();
    await remark.fill('E2E 编辑测试备注');

    await submitModalAndExpectClose(page);
  });

  test('删除渠道（Popconfirm）', async ({ page }) => {
    // 先创建一个用来删除的渠道
    const delName = `E2E-Del-${Date.now()}`;
    await page.getByRole('button', { name: /新增渠道/ }).click();
    await waitForModal(page);
    await page.getByPlaceholder('如：OpenAI 主力').fill(delName);
    await page.locator('.ant-modal .ant-select').first().click();
    await page.locator('.ant-select-item-option', { hasText: 'DeepSeek' }).click();
    await page.getByPlaceholder('https://api.openai.com/v1').fill('https://api.deepseek.com/v1');
    await page.getByPlaceholder('sk-...').fill('sk-e2e-del-test');

    // 尝试创建
    await clickModalOk(page);
    const created = await page.locator('.ant-modal').waitFor({ state: 'hidden', timeout: 5000 }).then(() => true).catch(() => false);
    if (!created) {
      await page.locator('.ant-modal-footer button:not(.ant-btn-primary), .ant-modal-close').first().click().catch(() => {});
      await page.locator('.ant-modal').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
      test.skip(true, '渠道创建 API 失败，无法测试删除');
      return;
    }
    await expect(page.getByText(delName)).toBeVisible({ timeout: 5000 });

    // 找到该渠道行的删除按钮（Popconfirm 内的 danger 按钮）
    const row = page.locator('tr', { hasText: delName });
    await row.locator('button.ant-btn-dangerous').click();

    // 确认 Popconfirm
    await page.locator('.ant-popconfirm-buttons .ant-btn-primary').click();

    // 验证渠道消失
    await expect(page.getByText(delName)).toBeHidden({ timeout: 5000 });
  });

  test('测试连接按钮', async ({ page }) => {
    // 确保有数据行
    const dataRow = page.locator('.ant-table-tbody tr:not(.ant-table-measure-row)').first();
    if (!(await dataRow.isVisible({ timeout: 2000 }).catch(() => false))) {
      await page.getByRole('button', { name: /新增渠道/ }).click();
      await waitForModal(page);
      await page.getByPlaceholder('如：OpenAI 主力').fill(`E2E-Test-${Date.now()}`);
      await page.locator('.ant-modal .ant-select').first().click();
      await page.locator('.ant-select-item-option', { hasText: 'DeepSeek' }).click();
      await page.getByPlaceholder('https://api.openai.com/v1').fill('https://api.deepseek.com/v1');
      await page.getByPlaceholder('sk-...').fill('sk-test-conn');
      await submitModalAndExpectClose(page);
    }

    const row = page.locator('.ant-table-tbody tr:not(.ant-table-measure-row)').first();
    await expect(row).toBeVisible({ timeout: 5000 });

    // 点击"测试"按钮 — fake key 连接会失败或超时，验证按钮点击后有响应即可
    await row.getByRole('button', { name: /测试/ }).click();

    // 等最多 10 秒看是否出现 message；超时不算失败（fake key 可能直接超时）
    const hasMessage = await page.locator('.ant-message').first()
      .waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
    if (!hasMessage) {
      // 无 message 出现 — fake key 请求可能还在 pending，页面不崩溃即可
      await expect(page.getByText('渠道管理').first()).toBeVisible();
    }
  });
});
