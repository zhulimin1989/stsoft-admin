// Sentry must init before any other module so its error handlers attach
// to the global window before React subscribes.
import { initSentry, SentryErrorBoundary } from './lib/sentry';
import { installChunkReloadHandlers } from './utils/chunkReload';
initSentry();
installChunkReloadHandlers();

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './i18n';
import './admin-shell.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SentryErrorBoundary
      fallback={({ error, resetError }) => (
        <div style={{ padding: '48px', textAlign: 'center', fontFamily: 'system-ui' }}>
          <h1 style={{ fontSize: '20px', marginBottom: '12px' }}>管理端出错了</h1>
          <p style={{ color: '#666', marginBottom: '24px', fontSize: '14px' }}>
            错误已上报，我们会尽快修复。
          </p>
          {import.meta.env.DEV ? (
            <pre style={{
              textAlign: 'left',
              background: '#f4f4f5',
              padding: '12px',
              borderRadius: '6px',
              maxWidth: '640px',
              margin: '0 auto 24px',
              overflow: 'auto',
              fontSize: '12px',
            }}>
              {error instanceof Error ? error.message : String(error)}
            </pre>
          ) : null}
          <button
            onClick={resetError}
            style={{
              padding: '8px 20px',
              borderRadius: '6px',
              border: '1px solid #d4d4d8',
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            重试
          </button>
        </div>
      )}
    >
      <App />
    </SentryErrorBoundary>
  </StrictMode>,
);
