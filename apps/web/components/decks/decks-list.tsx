'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  DECK_FORMATS,
  DECK_NAME_MAX,
  DeckFormatSchema,
  type OwnDeckSummary,
} from '@pokedrop/shared';
import { CircleAlert, CircleCheck, Copy, Plus, Swords, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ListError, LoadMore } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { applyApiError, Form, FormError, FormField } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { Toggle } from '@/components/ui/toggle';
import {
  useCloneDeck,
  useCreateDeck,
  useDeleteDeck,
  useMyDecks,
  useUpdateDeck,
} from '@/lib/query/decks';
import { toastSuccess } from '@/lib/toast';
import { FORMAT_LABELS, formatLabel } from './deck-format';

// The API's rules for a new deck's name and format, with sentences for people.
const NewDeckSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name the deck')
    .max(DECK_NAME_MAX, `Use at most ${DECK_NAME_MAX} characters`),
  format: DeckFormatSchema,
});
type NewDeck = z.infer<typeof NewDeckSchema>;

/** With `addCardId`, the new deck opens with that card added as an unsaved change. */
export function NewDeckDialog({
  open,
  onClose,
  addCardId,
}: {
  open: boolean;
  onClose: () => void;
  addCardId?: string;
}) {
  const router = useRouter();
  const create = useCreateDeck();
  const formatId = useId();
  const form = useForm<NewDeck>({
    resolver: zodResolver(NewDeckSchema),
    mode: 'onTouched',
    defaultValues: { name: '', format: 'standard' },
  });

  const submit = form.handleSubmit(async (values) => {
    try {
      const deck = await create.mutateAsync(values);
      router.push(
        addCardId ? `/decks/${deck.id}?add=${encodeURIComponent(addCardId)}` : `/decks/${deck.id}`,
      );
    } catch (error) {
      applyApiError(form, error);
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          form.reset();
          onClose();
        }
      }}
      icon={Plus}
      title="New deck"
      description="Name it and pick a format; you add the cards in the builder."
      confirmLabel="Create and open"
      confirming={create.isPending || form.formState.isSubmitting}
      onConfirm={() => void submit()}
    >
      <Form form={form} onSubmit={() => void submit()}>
        <FormField<NewDeck> name="name" label="Name" autoComplete="off" maxLength={DECK_NAME_MAX} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={formatId} className="text-small text-mut">
            Format
          </label>
          <select
            id={formatId}
            {...form.register('format')}
            className="focus-ring h-10 rounded-control border border-bd-2 bg-bg px-3 text-body text-tx"
          >
            {DECK_FORMATS.map((format) => (
              <option key={format} value={format}>
                {FORMAT_LABELS[format]}
              </option>
            ))}
          </select>
        </div>
        <FormError />
      </Form>
    </Dialog>
  );
}

function DeckCard({
  deck,
  onDelete,
}: {
  deck: OwnDeckSummary;
  onDelete: (deck: OwnDeckSummary) => void;
}) {
  const router = useRouter();
  const update = useUpdateDeck();
  const clone = useCloneDeck();

  return (
    <li className="flex flex-col gap-4 rounded-card border border-bd bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Link
            href={`/decks/${deck.id}`}
            className="focus-ring truncate rounded-tag text-h3 font-semibold hover:text-pri"
          >
            {deck.name}
          </Link>
          <span className="text-small text-mut">
            {formatLabel(deck.format)} · {deck.cardCount} cards
          </span>
        </div>
        {deck.valid ? (
          <Badge label="Valid" tone="success" icon={CircleCheck} />
        ) : (
          <Badge label="Invalid" tone="danger" icon={CircleAlert} />
        )}
      </div>
      {deck.valid ? null : (
        <p className="-mt-2 text-small text-red">
          Breaks a deck rule.{' '}
          <Link href={`/decks/${deck.id}`} className="focus-ring rounded-tag underline">
            Fix it in the builder
          </Link>
        </p>
      )}
      <Toggle
        label="Public"
        description={deck.isPublic ? 'Anyone with the link can see it.' : 'Only you can see it.'}
        checked={deck.isPublic}
        disabled={update.isPending}
        onCheckedChange={(isPublic) => update.mutate({ id: deck.id, patch: { isPublic } })}
      />
      <div className="mt-auto flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={Copy}
          loading={clone.isPending}
          onClick={() =>
            clone.mutate(deck.id, { onSuccess: (copy) => router.push(`/decks/${copy.id}`) })
          }
        >
          Clone
        </Button>
        <Button variant="ghost" size="sm" icon={Trash2} onClick={() => onDelete(deck)}>
          Delete
        </Button>
      </div>
    </li>
  );
}

export function DecksList() {
  const decks = useMyDecks();
  const remove = useDeleteDeck();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<OwnDeckSummary | null>(null);
  const items = decks.data?.pages.flatMap((page) => page.items) ?? [];
  const total = decks.data?.pages[0]?.total ?? 0;
  const invalid = items.filter((deck) => !deck.valid).length;

  return (
    <>
      <PageHeader
        title="Decks"
        description={
          decks.data
            ? `${total} ${total === 1 ? 'deck' : 'decks'}${invalid > 0 ? ` · ${invalid} need fixing` : ''}`
            : 'Your decks, newest edit first.'
        }
        actions={
          <Button icon={Plus} onClick={() => setCreating(true)}>
            New deck
          </Button>
        }
      />
      {decks.isPending ? (
        <ul
          aria-busy="true"
          aria-label="Loading decks"
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          {[0, 1, 2].map((slot) => (
            <li key={slot}>
              <Skeleton shape="block" height="12rem" />
            </li>
          ))}
        </ul>
      ) : decks.isError ? (
        <ListError error={decks.error} onRetry={() => void decks.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Swords}
          title="No decks yet"
          body="Build a deck from your cards, or from any card in the catalog."
          cta={{ label: 'Build your first deck', onClick: () => setCreating(true), icon: Plus }}
        />
      ) : (
        <>
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((deck) => (
              <DeckCard key={deck.id} deck={deck} onDelete={setDeleting} />
            ))}
          </ul>
          <LoadMore
            shown={items.length}
            total={total}
            noun={total === 1 ? 'deck' : 'decks'}
            hasMore={decks.hasNextPage}
            loading={decks.isFetchingNextPage}
            onLoad={() => void decks.fetchNextPage()}
          />
        </>
      )}
      <NewDeckDialog open={creating} onClose={() => setCreating(false)} />
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        tone="danger"
        icon={Trash2}
        title={deleting ? `Delete ${deleting.name}?` : 'Delete deck?'}
        description="The deck and its list are gone for good. Your cards stay in your collection."
        confirmLabel="Delete deck"
        confirming={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          const name = deleting.name;
          remove.mutate(deleting.id, {
            onSuccess: () => {
              setDeleting(null);
              toastSuccess(`Deleted ${name}`);
            },
          });
        }}
      />
    </>
  );
}
