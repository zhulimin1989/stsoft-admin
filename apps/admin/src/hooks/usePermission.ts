import { useAuthStore } from '../stores/auth-store';
import { expandPermissions } from './useLegacyPermission';

/**
 * Returns true when the current user owns the given permission key.
 *
 * Accepts both legacy (`admin.*`) and new-style keys; the owned set is
 * routed through `expandPermissions` so a backend that still emits legacy
 * keys can satisfy a check written against the new key.
 */
export function usePermission(permission: string): boolean {
  const user = useAuthStore((s) => s.user);
  const owned = user?.resolvedPermissions ?? [];
  return expandPermissions(owned).includes(permission);
}
