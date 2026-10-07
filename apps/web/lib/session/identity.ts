import type { MyProfile } from '@pokedrop/shared';

export type SessionIdentity = Pick<
  MyProfile,
  'id' | 'role' | 'displayName' | 'avatarUrl' | 'email'
>;

export function identityOf(profile: MyProfile): SessionIdentity {
  return {
    id: profile.id,
    role: profile.role,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    email: profile.email,
  };
}
