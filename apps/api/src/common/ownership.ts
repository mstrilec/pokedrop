import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from './request-auth.js';

/**
 * Deliberately without an admin bypass. The obvious-looking
 * `|| user.role === 'ADMIN'` would hand administrators every member capability
 * over every user's data. What the capability matrix grants admins is a short,
 * specific list, and each item is its own route behind `@Roles`.
 */
export function assertOwner(resourceOwnerId: string, user: AuthUser): void {
  if (resourceOwnerId !== user.id) {
    throw new ForbiddenException('Insufficient permissions');
  }
}
