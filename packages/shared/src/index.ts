import { z } from 'zod';

/**
 * Application roles.
 *
 * Enforced server-side by NestJS guards; the frontend uses this only to hide
 * what a role cannot do, never to authorise. See docs/PRD.md section 4.
 */
export const RoleSchema = z.enum(['MEMBER', 'ADMIN']);
export type Role = z.infer<typeof RoleSchema>;
