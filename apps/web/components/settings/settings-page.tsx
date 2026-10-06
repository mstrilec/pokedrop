'use client';

import { ListError } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/lib/query/me';
import { PasswordSettings } from './password-settings';
import { PrivacySettings } from './privacy-settings';
import { ProfileSettings } from './profile-settings';
import { SessionSettings } from './session-settings';

// No theme choice: dark is the only theme (D7 in docs/Pages.md).
export function SettingsPage() {
  const me = useMe();
  return (
    <>
      <PageHeader
        title="Account settings"
        description="Your profile, what visitors see, your password and where you’re signed in."
      />
      {me.data ? (
        <div className="flex max-w-4xl flex-col gap-6">
          <ProfileSettings me={me.data} />
          <PrivacySettings me={me.data} />
          <PasswordSettings />
          <SessionSettings />
        </div>
      ) : me.isError ? (
        <ListError error={me.error} onRetry={() => void me.refetch()} />
      ) : (
        <div aria-busy="true" aria-label="Loading your settings" className="flex flex-col gap-6">
          <Skeleton shape="block" height="18rem" />
          <Skeleton shape="block" height="10rem" />
        </div>
      )}
    </>
  );
}
