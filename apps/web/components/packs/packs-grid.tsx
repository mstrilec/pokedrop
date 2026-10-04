'use client';

import type { PackTemplateView } from '@pokedrop/shared';
import { PackageOpen } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ListError } from '@/components/list-states';
import { PackTemplateCard } from '@/components/packs/pack-template-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { openUrl } from '@/lib/pack-open-flow';
import { useMe } from '@/lib/query/me';
import { usePackTemplates } from '@/lib/query/packs';
import { ConfirmOpenDialog } from './confirm-open-dialog';

const GRID = 'grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

export function PacksGrid() {
  const router = useRouter();
  const templates = usePackTemplates();
  const balance = useMe().data?.currency ?? null;
  const [chosen, setChosen] = useState<PackTemplateView | null>(null);

  if (templates.isPending) {
    return (
      <ul aria-busy="true" aria-label="Loading packs" className={GRID}>
        {[0, 1, 2].map((slot) => (
          <li key={slot}>
            <Skeleton shape="block" height="22rem" />
          </li>
        ))}
      </ul>
    );
  }
  if (templates.isError) {
    return <ListError error={templates.error} onRetry={() => void templates.refetch()} />;
  }
  if (templates.data.length === 0) {
    return (
      <EmptyState
        icon={PackageOpen}
        title="No packs on sale right now"
        body="New packs appear here as soon as they are released."
        cta={{ label: 'See your pack history', href: '/packs/history' }}
      />
    );
  }

  const anyUnaffordable =
    balance !== null && templates.data.some((template) => template.cost > balance);

  return (
    <>
      <ul className={GRID}>
        {templates.data.map((template) => (
          <li key={template.id}>
            <PackTemplateCard
              template={{
                name: template.name,
                cost: template.cost,
                cardCount: template.contents.cardCount,
                guarantee: template.guarantee,
              }}
              balance={balance}
              onOpen={() => setChosen(template)}
            />
          </li>
        ))}
      </ul>
      {anyUnaffordable ? (
        <p className="mt-6 text-center text-small text-mut">
          Short of coins?{' '}
          <Link
            href="/wallet"
            className="focus-ring rounded-tag font-medium text-pri hover:underline"
          >
            See your wallet
          </Link>
        </p>
      ) : null}
      <ConfirmOpenDialog
        template={chosen}
        onClose={() => setChosen(null)}
        onConfirm={(template) => router.push(openUrl(template.id))}
      />
    </>
  );
}
