'use client';

import type { MyProfile, ProfilePrivacy } from '@pokedrop/shared';
import Link from 'next/link';
import { Toggle } from '@/components/ui/toggle';
import { useUpdateMe } from '@/lib/query/account';
import { toastApiError, toastSuccess } from '@/lib/toast';
import { SettingsSection } from './settings-section';

const TOGGLES: {
  key: keyof ProfilePrivacy;
  label: string;
  description: string;
  shown: string;
  hidden: string;
}[] = [
  {
    key: 'showCollectionValue',
    label: 'Show my collection value',
    description: 'The market value of your cards, on your public profile.',
    shown: 'Visitors now see your collection value',
    hidden: 'Your collection value is hidden from visitors',
  },
  {
    key: 'showSetCompletion',
    label: 'Show my set completion',
    description: 'How many different cards you hold, and how far along your sets are.',
    shown: 'Visitors now see your set completion',
    hidden: 'Your set completion is hidden from visitors',
  },
];

/** Each toggle saves on its own; the public profile reads it on the next request. */
export function PrivacySettings({ me }: { me: MyProfile }) {
  const update = useUpdateMe();
  const pending = update.isPending ? update.variables : undefined;

  return (
    <SettingsSection
      id="privacy"
      title="Privacy"
      description={
        <>
          What{' '}
          <Link href={`/profile/${me.id}`} className="text-pri hover:underline">
            your public profile
          </Link>{' '}
          shows besides your name, showcase and public decks. Off means not on the page at all.
        </>
      }
    >
      <div className="flex flex-col divide-y divide-bd">
        {TOGGLES.map((toggle) => (
          <Toggle
            key={toggle.key}
            label={toggle.label}
            description={toggle.description}
            checked={pending?.[toggle.key] ?? me.privacy[toggle.key]}
            disabled={update.isPending}
            onCheckedChange={(checked) =>
              update.mutate(
                { [toggle.key]: checked },
                {
                  onSuccess: () => toastSuccess(checked ? toggle.shown : toggle.hidden),
                  onError: toastApiError,
                },
              )
            }
            className="py-3 first:pt-0 last:pb-0"
          />
        ))}
      </div>
    </SettingsSection>
  );
}
