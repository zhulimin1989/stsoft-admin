import { test, expect } from '@playwright/test';
import { adminLogin } from './helpers';

const adminPages = [
  { path: '/transactions', title: '交易流水' },
  { path: '/plan-templates', title: '套餐管理' },
  { path: '/model-access', title: '模型权限矩阵' },
  { path: '/revenue', title: '营收概览' },
  { path: '/sessions', title: '会话监控' },
  { path: '/monitoring', title: '系统监控' },
  { path: '/announcements', title: '公告管理' },
  { path: '/audit-logs', title: '审计日志' },
  { path: '/feature-flags', title: '功能开关' },
  { path: '/system-prompts', title: '系统提示词' },
  { path: '/system-config', title: '系统配置' },
  { path: '/channels', title: '渠道管理' },
  { path: '/orders', title: '订单管理' },
  { path: '/payment-config', title: '支付配置' },
  { path: '/roles', title: '角色管理' },
  { path: '/members', title: '后台账号管理' },
];

test.describe('管理端所有页面渲染验证', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  for (const pageConfig of adminPages) {
    test(`${pageConfig.title} (${pageConfig.path}) 正常加载`, async ({ page }) => {
      await page.goto(pageConfig.path);
      await expect(page.getByText(pageConfig.title).first()).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('无权限')).toHaveCount(0);
    });
  }
});
