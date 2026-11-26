import { renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { usePermission } from '../usePermission';
import { useAuthStore } from '../../stores/auth-store';

describe('usePermission', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, loading: false });
  });

  it('returns false when no user', () => {
    const { result } = renderHook(() => usePermission('users.manage'));
    expect(result.current).toBe(false);
  });

  it('returns true for new-style key satisfied via legacy mapping', () => {
    useAuthStore.setState({
      user: { id: '1', email: 'a@b.c', nickname: 'a', resolvedPermissions: ['admin.users.manage'] },
      loading: false,
    });
    const { result } = renderHook(() => usePermission('users.manage'));
    expect(result.current).toBe(true);
  });

  it('returns false when permission absent', () => {
    useAuthStore.setState({
      user: { id: '1', email: 'a@b.c', nickname: 'a', resolvedPermissions: ['admin.users.view'] },
      loading: false,
    });
    const { result } = renderHook(() => usePermission('finance.orders.manage'));
    expect(result.current).toBe(false);
  });
});
