import { z } from 'zod';
import { RoleSchema } from '../enums.js';
import { CurrencyTransactionIdSchema, UserIdSchema } from '../primitives/id.js';
import { PaginationQuerySchema, pageOf } from '../primitives/pagination.js';
import { InventoryCardSchema, InventorySummarySchema } from './inventory.js';
import { TradePartySchema } from './trade.js';

export const UserSchema = z.object({
  id: UserIdSchema,
  email: z.email(),
  displayName: z.string().min(1).max(64),
  avatarUrl: z.url().nullable(),
  role: RoleSchema,
  currency: z.number().int().min(0),
  createdAt: z.coerce.date(),
});
export type User = z.infer<typeof UserSchema>;

export const PublicUserSchema = UserSchema.omit({
  email: true,
  currency: true,
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

export const SHOWCASE_MAX_CARDS = 6;

export const ProfilePrivacySchema = z.object({
  showCollectionValue: z.boolean(),
  showSetCompletion: z.boolean(),
});
export type ProfilePrivacy = z.infer<typeof ProfilePrivacySchema>;

/**
 * The rules for who a user says they are, wherever they say it: sign-up and
 * PATCH /users/me. Better Auth's own sign-up body takes any string for both.
 */
export const ProfileIdentitySchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Enter a display name')
    .max(64, 'Use at most 64 characters'),
  avatarUrl: z
    .url({ protocol: /^https$/ })
    .max(2048)
    .nullable(),
});

/**
 * `showcase` holds only cards the user still owns, in the order they chose.
 * Name and avatar are read as the table holds them: accounts created before
 * sign-up was validated may carry values the form would refuse.
 */
export const MyProfileSchema = UserSchema.extend({
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  privacy: ProfilePrivacySchema,
  showcase: z.array(InventoryCardSchema),
});
export type MyProfile = z.infer<typeof MyProfileSchema>;

/** Strict: `role`, `currency` and `email` are unknown keys here, and so a 400. */
export const UpdateMyProfileSchema = z.strictObject({
  displayName: ProfileIdentitySchema.shape.displayName.optional(),
  avatarUrl: ProfileIdentitySchema.shape.avatarUrl.optional(),
  showCollectionValue: z.boolean().optional(),
  showSetCompletion: z.boolean().optional(),
  showcaseCardIds: z
    .array(z.string().min(1).max(64))
    .max(SHOWCASE_MAX_CARDS)
    .refine((ids) => new Set(ids).size === ids.length, 'A card can be showcased only once')
    .optional(),
});
export type UpdateMyProfile = z.infer<typeof UpdateMyProfileSchema>;

/**
 * Built field by field, never by omitting from the full user. The two
 * collection fields are absent — not null — unless their owner turned them on.
 */
export const PublicProfileSchema = z.object({
  id: UserIdSchema,
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  joinedAt: z.coerce.date(),
  showcase: z.array(InventoryCardSchema),
  publicDeckCount: z.number().int().min(0),
  collection: InventorySummarySchema.pick({
    collectionValueUsd: true,
    pricedCards: true,
  }).optional(),
  completion: InventorySummarySchema.pick({ uniqueCards: true, setCompletion: true }).optional(),
});
export type PublicProfile = z.infer<typeof PublicProfileSchema>;

/** A member's name search for a trade counterparty: only what a public profile shows. */
export const UserSearchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .refine((value) => !value.includes('\u0000'), 'must not contain a NUL character'),
});
export type UserSearchQuery = z.infer<typeof UserSearchQuerySchema>;

export const USER_SEARCH_LIMIT = 10;

export const UserSearchResultSchema = z.array(TradePartySchema).max(USER_SEARCH_LIMIT);
export type UserSearchResult = z.infer<typeof UserSearchResultSchema>;

export const AdminUserListQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  role: RoleSchema.optional(),
  suspended: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  page: PaginationQuerySchema.shape.page,
  pageSize: PaginationQuerySchema.shape.pageSize,
});
export type AdminUserListQuery = z.infer<typeof AdminUserListQuerySchema>;

/**
 * What the table can hold rather than what a form accepts: Better Auth's
 * sign-up takes any name and image, and an admin must be able to see - and
 * suspend - the account that sent a bad one.
 */
export const AdminUserRowSchema = z.object({
  id: UserIdSchema,
  email: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  role: RoleSchema,
  currency: z.number().int(),
  emailVerified: z.boolean(),
  suspendedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});
export type AdminUserRow = z.infer<typeof AdminUserRowSchema>;

export const AdminUserPageSchema = pageOf(AdminUserRowSchema);
export type AdminUserPage = z.infer<typeof AdminUserPageSchema>;

export const ChangeRoleSchema = z.strictObject({ role: RoleSchema });
export type ChangeRole = z.infer<typeof ChangeRoleSchema>;

/** `grantId` makes a retry harmless, as `openId` does for a pack open. Negative adjusts down. */
export const GrantCurrencySchema = z.strictObject({
  grantId: z.uuid(),
  amount: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((amount) => amount !== 0, 'amount must not be zero'),
  reason: z.string().trim().min(1).max(500),
});
export type GrantCurrency = z.infer<typeof GrantCurrencySchema>;

export const GrantResultSchema = z.object({
  userId: UserIdSchema,
  balance: z.number().int().min(0),
  transaction: z.object({
    id: CurrencyTransactionIdSchema,
    amount: z.number().int(),
    createdAt: z.coerce.date(),
  }),
});
export type GrantResult = z.infer<typeof GrantResultSchema>;

export const SuspendUserSchema = z.strictObject({ reason: z.string().trim().min(1).max(500) });
export type SuspendUser = z.infer<typeof SuspendUserSchema>;
