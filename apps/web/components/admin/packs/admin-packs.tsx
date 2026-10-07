'use client';

import type { PackTemplate } from '@pokedrop/shared';
import { Coins, PackageOpen, Plus } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { ListError } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCoins } from '@/lib/format';
import { useAdminPackTemplates } from '@/lib/query/admin';
import { cn } from '@/lib/utils';
import { TemplateEditor } from './template-editor';

const cardsIn = (template: PackTemplate) =>
  template.slotConfig.slots.reduce((sum, slot) => sum + slot.count, 0);

export function AdminPacks() {
  const templates = useAdminPackTemplates();
  // `null` is a new template; undefined, nothing chosen yet (the first one shows).
  const params = useSearchParams();
  // `?template=` from the audit log's links.
  const [chosen, setChosen] = useState<string | null | undefined>(
    () => params.get('template') ?? undefined,
  );
  const list = templates.data ?? [];
  const selectedId = chosen === undefined ? (list[0]?.id ?? null) : chosen;
  const selected = list.find((t) => t.id === selectedId) ?? null;

  return (
    <>
      <PageHeader
        title="Pack templates"
        description="What a pack costs, which sets it draws from, and the rarity weights of each slot. Every save is audit-logged."
        actions={
          <Button icon={Plus} onClick={() => setChosen(null)}>
            New template
          </Button>
        }
      />
      {templates.isPending ? (
        <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <Skeleton shape="block" height="16rem" />
          <Skeleton shape="block" height="30rem" />
        </div>
      ) : templates.isError ? (
        <ListError error={templates.error} onRetry={() => void templates.refetch()} />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          {list.length === 0 ? (
            <EmptyState
              icon={PackageOpen}
              title="No templates yet"
              body="Create the first pack members can buy."
              cta={{ label: 'New template', onClick: () => setChosen(null), icon: Plus }}
            />
          ) : (
            <ul aria-label="Templates" className="flex flex-col gap-2">
              {list.map((template) => {
                const current = template.id === selectedId;
                return (
                  <li key={template.id}>
                    <button
                      type="button"
                      aria-current={current ? 'true' : undefined}
                      onClick={() => setChosen(template.id)}
                      className={cn(
                        'focus-ring flex w-full cursor-pointer items-center gap-3 rounded-card border p-3 text-left transition',
                        current
                          ? 'border-pri bg-pri-dim'
                          : 'border-bd bg-surface hover:bg-surface-2',
                      )}
                    >
                      <PackageOpen aria-hidden className="size-5 shrink-0 text-pri" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-medium text-tx">{template.name}</span>
                        <span className="flex items-center gap-1 text-[11.5px] text-mut">
                          {cardsIn(template)} cards ·
                          <Coins aria-hidden className="size-3 text-gold" />
                          {formatCoins(template.cost)}
                        </span>
                      </span>
                      <Badge
                        label={template.active ? 'On sale' : 'Off'}
                        tone={template.active ? 'success' : 'neutral'}
                        shape="tag"
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {selected || selectedId === null ? (
            <div className="rounded-card border border-bd bg-surface p-5">
              <TemplateEditor
                key={
                  selected
                    ? `${selected.id}:${selected.cost}:${selected.name}:${JSON.stringify(selected.slotConfig)}:${selected.setFilter.setIds.join()}`
                    : 'new'
                }
                template={selected}
                onSaved={(saved) => setChosen(saved.id)}
              />
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
