import { test, expect } from '@playwright/test';
import { adminLogin, waitForModal, clickModalOk, waitForModalClose, submitModalAndExpectClose } from './helpers';

test.describe('系统提示词 — 功能测试', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await page.goto('/system-prompts');
    await expect(page.getByText('系统提示词').first()).toBeVisible({ timeout: 10000 });
  });

  test('创建新提示词', async ({ page }) => {
    const name = `e2e_prompt_${Date.now()}`;
    await page.getByRole('button', { name: /新增提示词/ }).click();
    await waitForModal(page);

    // 验证弹窗标题
    await expect(page.locator('.ant-modal-header')).toContainText('新增提示词');

    // 填写名称
    await page.getByPlaceholder('如: system_prompt, chat_summarizer').fill(name);
    // 填写内容
    await page.getByPlaceholder('输入系统提示词内容...').fill(
      '你是一个专业的AI助手。请认真回答用户的问题，保持专业且友好的态度。'
    );

    await submitModalAndExpectClose(page);

    // 验证新卡片出现
    await expect(page.getByText(name)).toBeVisible({ timeout: 5000 });
    // 版本号应为 v1
    await expect(page.getByText('v1')).toBeVisible();
  });

  test('编辑提示词（点击卡片打开弹窗）', async ({ page }) => {
    // 等待卡片加载
    await page.waitForTimeout(2000);

    const cards = page.locator('.ant-card');
    const cardCount = await cards.count();
    if (cardCount === 0) {
      test.skip(true, '无提示词卡片（空数据），跳过编辑测试');
      return;
    }

    const firstCard = cards.first();
    // 点击卡片打开编辑弹窗
    await firstCard.click();
    await waitForModal(page);

    // 验证弹窗标题包含"编辑提示词"
    await expect(page.locator('.ant-modal-header')).toContainText('编辑提示词');

    // 名称应不可编辑
    const nameInput = page.locator('.ant-modal-body').getByPlaceholder('如: system_prompt, chat_summarizer');
    await expect(nameInput).toBeDisabled();

    // 修改内容
    const contentArea = page.locator('.ant-modal-body textarea');
    const original = await contentArea.inputValue();
    await contentArea.clear();
    await contentArea.fill(original + '\n// E2E 编辑追加');

    await submitModalAndExpectClose(page);
  });

  test('刷新按钮', async ({ page }) => {
    await page.getByRole('button', { name: /刷新/ }).click();
    await expect(page.getByText('系统提示词').first()).toBeVisible({ timeout: 5000 });
  });

  test('空状态展示', async ({ page }) => {
    // 如果没有数据应显示空状态（无法保证触发，仅验证页面不崩溃）
    await expect(page.getByText('系统提示词').first()).toBeVisible();
  });
});
