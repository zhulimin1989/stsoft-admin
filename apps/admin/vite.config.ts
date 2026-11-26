import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import path from 'path';

// Sentry sourcemap upload runs only when SENTRY_AUTH_TOKEN is provided
// (CI). Locally the plugin is a no-op so devs can build without an auth token.
const sentryPlugin = process.env.SENTRY_AUTH_TOKEN
  ? sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT ?? 'admin',
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: { name: process.env.GIT_COMMIT_SHA },
      sourcemaps: {
        filesToDeleteAfterUpload: ['./dist/**/*.map'],
      },
  })
  : null;

function manualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined;
  if (/[\\/]node_modules[\\/](react|react-dom|react-router-dom)[\\/]/.test(id)) {
    return 'vendor-react';
  }
  if (
    /[\\/]node_modules[\\/](antd|@ant-design|rc-[^\\/]+|@rc-component)[\\/]/.test(id)
  ) {
    return 'vendor-ui';
  }
  if (/[\\/]node_modules[\\/](recharts|d3-[^\\/]+)[\\/]/.test(id)) {
    return 'vendor-charts';
  }
  if (/[\\/]node_modules[\\/]@sentry[\\/]/.test(id)) {
    return 'vendor-observability';
  }
  if (
    /[\\/]node_modules[\\/](axios|dayjs|i18next|react-i18next|styled-components|zustand)[\\/]/.test(
      id,
    )
  ) {
    return 'vendor-utils';
  }
  return undefined;
}

export default defineConfig({
  plugins: [react(), ...(sentryPlugin ? [sentryPlugin] : [])],
  // pnpm links workspace packages outside node_modules. Pre-bundle the shared
  // CommonJS build in dev so browsers receive valid ESM named exports.
  optimizeDeps: {
    include: ['@ruidong/shared'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Generate sourcemaps so Sentry can map minified stacks back to source.
  // filesToDeleteAfterUpload above removes them from the shipped bundle.
  build: {
    sourcemap: true,
    // Workspace packages resolve to their real path outside node_modules.
    // Include shared's CommonJS build so runtime exports can be bundled.
    commonjsOptions: {
      include: [/node_modules/, /packages\/shared/],
    },
    // Ant Design and rc-* depend on each other; keeping them in one UI vendor chunk
    // avoids Rollup circular chunk warnings. Alert only when it grows materially.
    chunkSizeWarningLimit: 1300,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  server: {
    proxy: {
      // admin web 调 admin API（默认 :3001）。可用 ADMIN_API_PROXY_TARGET 覆盖。
      // 注：早先脚手架默认指向 :3000（用户 API），对 admin 不正确。
      '/api': {
        target: process.env.ADMIN_API_PROXY_TARGET || 'http://localhost:3001',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
});
