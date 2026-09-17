import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from './request-auth.js';

/**
 * Asserts that the caller owns the resource.
 *
 * **Deliberately without an admin bypass.** The obvious-looking
 * `|| user.role === 'ADMIN'` would hand administrators every member capability
 * over every user's data — editing anyone's deck, reading anyone's private
 * inventory — none of which appears in the capability matrix in docs/PRD.md §4.
 * What that matrix does grant admins is a short, specific list: pack templates,
 * sync, currency grants, roles and suspension, audit logs, and voiding trades.
 * Each of those is its own route behind `@Roles(Role.ADMIN)`, where the power
 * is visible, auditable and reviewable.
 *
 * An ownership check is about whose data it is. A role check is about what the
 * caller is allowed to do. Collapsing the two is how "admin" quietly becomes
 * "may do anything to anyone".
 */
export function assertOwner(resourceOwnerId: string, user: AuthUser): void {
  if (resourceOwnerId !== user.id) {
    // Deliberately not "this deck belongs to someone else" — that would confirm
    // the resource exists to a caller who has no business knowing.
    throw new ForbiddenException('Insufficient permissions');
  }
}
