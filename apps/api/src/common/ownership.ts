import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from './request-auth.js';

/**
 * No admin bypass, deliberately: `|| user.role === 'ADMIN'` would hand admins every member
 * capability over everyone's data. Admin powers are their own routes behind `@Roles`.
 */
export function assertOwner(resourceOwnerId: string, user: AuthUser): void {
  if (resourceOwnerId !== user.id) {
    throw new ForbiddenException('Insufficient permissions');
  }
}
