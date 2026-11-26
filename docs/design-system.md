# 设计系统文档

## 双端定位

| 维度 | Web 用户端 | Admin 管理端 |
|------|------------|--------------|
| 使用对象 | API 按量计费用户 | 内部运营、财务、管理员 |
| 设计目标 | 清晰、轻量、偏开发者控制台 | 高密度、可审计、可批量操作 |
| UI 基础 | Tailwind CSS 4 + CVA + Lucide | Ant Design 5 + Pro Components |
| 图表 | Recharts | Recharts |
| Toast | Sonner | Ant Design message |
| 字体 | Inter + Noto Sans SC | System + PingFang SC |

## Web 用户端规范

### 页面骨架

所有登录后的控制台页面优先使用：

- `PageShell`：统一页面内边距、最大宽度和内容节奏。
- `PageHeader`：统一标题、说明和右侧主操作。
- `SectionPanel`：统一业务区块容器。
- `MetricTile`：统一指标卡。

组件位置：`apps/web/src/components/layout/page-shell.tsx`

### 标题层级

| 层级 | 用法 | 规格 |
|------|------|------|
| Page title | 每个页面唯一主标题 | 28px / semibold / `#0A0F1A` |
| Section title | 页面内业务区块 | 16px / semibold |
| Card label | 指标或表单标签 | 12-14px / medium |
| Body text | 描述、状态、辅助说明 | 14px / normal / muted |

不要在控制台页面混用 `text-2xl`、`text-[22px]`、`text-3xl` 作为主标题；新增页面应走 `PageHeader`。

### 页面布局

- 控制台内容区固定为浅色面板，侧边栏只做导航和账号退出。
- 账户余额属于全局状态，显示在内容区右上角，不放在侧边栏底部。
- 常规页面使用 `max-w-6xl`；需要表格横向空间时使用 `PageShell width="full"`。
- 业务区块用 `rounded-lg border border-border bg-card`，避免多层卡片嵌套。
- 主操作放在 `PageHeader.actions`；区块级操作放在 `SectionPanel.actions`。

### 颜色

Web 端当前 token 来自 `apps/web/src/globals.css`：

```css
--background: #F5F2EC;
--foreground: #2A2F3A;
--card: #FAFAF7;
--primary: #0E2A47;
--accent: #E8B464;
--muted: #F1ECE2;
--muted-foreground: #6B7280;
--border: #E7E1D7;
--destructive: #C85A54;
```

### 交互口径

- 图标使用 Lucide。
- 能导航的操作必须是链接或真实按钮，不保留无 handler 的假按钮。
- 读写能力要分清：如果后端不支持用户自助修改，只展示平台策略和可操作的替代入口。
- 表格、筛选、Tab 和弹窗都要有加载态、空态和错误态。

## Admin 管理端规范

Admin 端继续以 Ant Design 为基础，强调信息密度和权限态：

- 页面主标题、筛选区、表格、详情抽屉保持统一。
- 写操作按后端权限隐藏或禁用。
- 批量动作必须有确认、结果反馈和失败提示。
- 不与 Web 端共享 UI 组件，只共享类型、接口契约和设计 token 语义。
