import { z } from 'zod';
import { RoleSchema } from '../enums.js';
import { UserIdSchema } from '../primitives/id.js';
import { InventoryCardSchema, InventorySummarySchema } from './inventory.js';

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

/** `showcase` holds only cards the user still owns, in the order they chose. */
export const MyProfileSchema = UserSchema.extend({
  privacy: ProfilePrivacySchema,
  showcase: z.array(InventoryCardSchema),
});
export type MyProfile = z.infer<typeof MyProfileSchema>;

/** Strict: `role`, `currency` and `email` are unknown keys here, and so a 400. */
export const UpdateMyProfileSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(64).optional(),
  avatarUrl: z
    .url({ protocol: /^https$/ })
    .max(2048)
    .nullable()
    .optional(),
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
