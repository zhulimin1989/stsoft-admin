import { Page, expect } from '@playwright/test';

/**
 * 管理端统一登录。Playwright 默认每个 test 启动全新 BrowserContext（等同无痕模式），
 * 无需额外配置 incognito。
 */
export async function adminLogin(page: Page) {
  const accessToken = process.env.ADMIN_ACCESS_TOKEN;
  if (accessToken) {
    const baseURL = process.env.ADMIN_BASE_URL || 'http://localhost:5174';
    await page.context().addCookies([
      {
        name: 'admin_access_token',
        value: accessToken,
        url: baseURL,
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
    await page.goto('/');
    await expect(page.getByText('运营总览')).toBeVisible({ timeout: 10000 });
    return;
  }

  await page.goto('/login');
  await page.getByPlaceholder('admin@example.com').fill(process.env.ADMIN_EMAIL || 'admin@iruidong.com');
  await page.getByPlaceholder('输入密码').fill(process.env.ADMIN_PASSWORD || 'admin123');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText('运营总览')).toBeVisible({ timeout: 10000 });
}

/** 等待 AntD 表格加载完毕 */
export async function waitForTable(page: Page) {
  await expect(page.locator('.ant-table')).toBeVisible({ timeout: 10000 });
  // 等 loading spinner 消失
  await page.locator('.ant-spin-spinning').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
}

/** 等待 AntD Modal 打开 */
export async function waitForModal(page: Page) {
  await expect(page.locator('.ant-modal-body')).toBeVisible({ timeout: 5000 });
}

/** 点击 Modal 确认按钮（主按钮） */
export async function clickModalOk(page: Page) {
  await page.locator('.ant-modal-footer button.ant-btn-primary').click();
}

/** 等待 Modal 关闭 */
export async function waitForModalClose(page: Page) {
  await expect(page.locator('.ant-modal')).toBeHidden({ timeout: 5000 });
}

/**
 * 点击 Modal 确认并等待关闭，兼容 API 失败场景。
 * - 点击确认后等待最多 waitMs 毫秒
 * - 如果 Modal 仍然可见，检查错误信息，手动关闭 Modal 并抛出明确错误
 */
export async function submitModalAndExpectClose(page: Page, waitMs = 5000) {
  await clickModalOk(page);
  const closed = await page.locator('.ant-modal').waitFor({ state: 'hidden', timeout: waitMs }).then(() => true).catch(() => false);
  if (!closed) {
    // Modal 未关闭 — 可能 API 出错
    const errorText = await page.locator('.ant-modal-body .ant-form-item-explain-error, .ant-message-error, .ant-alert-error').textContent().catch(() => '');
    // 关闭 modal
    await page.locator('.ant-modal-footer button:not(.ant-btn-primary), .ant-modal-close').first().click().catch(() => {});
    await page.locator('.ant-modal').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    throw new Error(`Modal 未在 ${waitMs}ms 内关闭（API 可能失败）。错误信息: ${errorText || '无'}`);
  }
}

/** 等待 AntD message 提示（匹配文本） */
export async function waitForMessage(page: Page, text: string | RegExp) {
  await expect(page.locator('.ant-message').getByText(text)).toBeVisible({ timeout: 5000 });
}

/** 在 AntD Select 下拉中选择选项 */
export async function selectOption(page: Page, selector: string, optionText: string) {
  await page.locator(selector).click();
  await page.locator('.ant-select-item-option', { hasText: optionText }).click();
}
