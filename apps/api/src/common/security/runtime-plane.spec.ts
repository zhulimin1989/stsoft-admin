import { isRuntimePlanePathAllowed } from './runtime-plane';

describe('runtime plane route isolation', () => {
  it('allows admin routes and rejects non-admin routes', () => {
    expect(isRuntimePlanePathAllowed('admin', '/api/admin/auth/profile')).toBe(true);
    expect(isRuntimePlanePathAllowed('admin', '/api/admin/v2/risk-rules')).toBe(true);
    expect(isRuntimePlanePathAllowed('admin', '/api/auth/login')).toBe(false);
    expect(isRuntimePlanePathAllowed('admin', '/api/v1/chat/completions')).toBe(false);
  });
});
