import { SetMetadata } from '@nestjs/common';

export const ADMIN_PERMISSION_KEY = 'admin_permissions';
export const ADMIN_NO_PERMISSION_REQUIRED_KEY = 'admin_no_permission_required';
export const RequireAdminPermission = (...permissions: string[]) =>
  SetMetadata(ADMIN_PERMISSION_KEY, permissions);
export const NoAdminPermissionRequired = () =>
  SetMetadata(ADMIN_NO_PERMISSION_REQUIRED_KEY, true);
