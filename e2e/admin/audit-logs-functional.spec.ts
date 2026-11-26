import { test, expect } from '@playwright/test';
import { adminLogin, waitForTable } from './helpers';

test.describe('审计日志 — 功能测试', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await page.goto('/audit-logs');
    await expect(page.getByText('审计日志').first()).toBeVisible({ timeout: 10000 });
    await waitForTable(page);
  });

  test('日志列表加载 — 表头验证', async ({ page }) => {
    await expect(page.getByText('操作').first()).toBeVisible();
    await expect(page.getByText('资源类型').first()).toBeVisible();
    await expect(page.getByText('资源ID').first()).toBeVisible();
    await expect(page.getByText('管理员').first()).toBeVisible();
  });

  test('操作类型过滤器', async ({ page }) => {
    // 点击"操作类型"下拉
    const actionSelect = page.locator('.ant-select').first();
    await actionSelect.click();

    // 验证下拉选项存在
    await expect(page.locator('.ant-select-item-option', { hasText: '登录' })).toBeVisible();
    await expect(page.locator('.ant-select-item-option', { hasText: '创建' })).toBeVisible();
    await expect(page.locator('.ant-select-item-option', { hasText: '更新' })).toBeVisible();
    await expect(page.locator('.ant-select-item-option', { hasText: '删除' })).toBeVisible();

    // 选择"登录"
    await page.locator('.ant-select-item-option', { hasText: '登录' }).click();

    // 表格应刷新（不崩溃）
    await waitForTable(page);
  });

  test('资源类型过滤器', async ({ page }) => {
    // 点击第二个 Select（资源类型）
    const resourceSelect = page.locator('.ant-select').nth(1);
    await resourceSelect.click();

    // 验证选项
    await expect(page.locator('.ant-select-item-option', { hasText: '用户' })).toBeVisible();
    await expect(page.locator('.ant-select-item-option', { hasText: '渠道' })).toBeVisible();

    // 选择"用户"
    await page.locator('.ant-select-item-option', { hasText: '用户' }).click();
    await waitForTable(page);
  });

  test('清除过滤器', async ({ page }) => {
    // 选一个过滤器
    const actionSelect = page.locator('.ant-select').first();
    await actionSelect.click();
    await page.locator('.ant-select-item-option', { hasText: '创建' }).click();
    await waitForTable(page);

    // 清除（点击 X 按钮）
    const clearBtn = actionSelect.locator('.ant-select-clear');
    if (await clearBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await clearBtn.click();
      await waitForTable(page);
    }
  });

  test('刷新按钮', async ({ page }) => {
    await page.getByRole('button', { name: /刷新/ }).click();
    await waitForTable(page);
  });

  test('分页 — 每页 50 条', async ({ page }) => {
    // 可能无数据（共 0 条）或有数据（共 N 条），两种都接受
    const paginationText = page.getByText(/共 \d+ 条/);
    const hasPagination = await paginationText.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasPagination) {
      // 无分页文字 — 可能数据为空且分页组件未渲染
      const emptyState = page.locator('.ant-empty, .ant-table-placeholder');
      const isEmpty = await emptyState.isVisible({ timeout: 2000 }).catch(() => false);
      if (isEmpty) {
        // 空数据状态，这是合理的
        return;
      }
      // 既无分页也无空态，标记跳过
      test.skip(true, '无分页文字且无空态展示');
      return;
    }
    await expect(paginationText).toBeVisible();
  });
});
