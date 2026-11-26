# 前端性能预算

## 预算表

| 指标 | Web 端 | Admin 端 | 测量方式 |
|------|--------|---------|---------|
| 初始 JS (gzip) | < 150 KB | < 200 KB | `du -sk dist/assets/*.js` |
| 初始 CSS (gzip) | < 30 KB | < 50 KB | `du -sk dist/assets/*.css` |
| LCP | < 2.5s | < 3.0s | Lighthouse |
| FID | < 100ms | < 100ms | Lighthouse |
| CLS | < 0.1 | < 0.1 | Lighthouse |

## 当前状态

| App | JS 大小 (gzip) | 状态 |
|-----|---------------|------|
| Web | ~225 KB | 超预算 — 需 manualChunks 分包 |
| Admin | ~244 KB | 超预算 — Ant Design 体积大，可接受 |

## 优化手段

### Web 端
1. `manualChunks` 分离 vendor（React/Router）和 charts（Recharts）
2. 营销页图片懒加载
3. 平台页已使用 `lazy()` 代码分割

### Admin 端
1. Ant Design 按需导入（已默认 tree-shaking）
2. Pro Components 考虑替换为轻量组件
3. 图表数据按需加载

## CI 集成

`.github/workflows/ci.yml` 的 `build` job 中已添加 bundle size check。
超过预算会产生 CI warning。
