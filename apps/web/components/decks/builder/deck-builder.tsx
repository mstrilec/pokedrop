'use client';

import { type DeckDetail, PlayableCardSchema } from '@pokedrop/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Trash2, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { addRefusal, saveBlocker } from '@/components/decks/deck-rules';
import { focusDeckSlot } from '@/components/decks/deck-slot';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Tabs, TabsPanel } from '@/components/ui/tabs';
import { ApiError } from '@/lib/api/core';
import { useCard } from '@/lib/query/catalog';
import { useSaveDeck } from '@/lib/query/decks';
import { keys } from '@/lib/query/keys';
import { DeckDraftProvider, isDirty, useDeckDraft } from '@/lib/stores/deck-draft';
import { toastApiError, toastError, toastSuccess } from '@/lib/toast';
import { useMediaQuery } from '@/lib/use-media-query';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { BuilderDnd, DECK_ZONE, DropZone, POOL_ZONE } from './builder-dnd';
import { BuilderHeader, failingRules } from './builder-header';
import { CardPool } from './card-pool';
import { DeckChecks } from './deck-checks';
import { DeckList } from './deck-list';
import { useDeckChecks } from './use-deck-checks';

type Tab = 'pool' | 'deck' | 'check';

// Below the 60 px topbar and the main element's 2 × 32 px padding.
const BUILDER_HEIGHT = 'calc(100dvh - 3.75rem - 4rem)';

/**
 * The store takes the first `deck` only; later answers (a Public flip refetches) never reset it.
 * `addCardId` (`?add=`, from a card page) arrives as one more copy, unsaved.
 */
export function DeckBuilder({ deck, addCardId }: { deck: DeckDetail; addCardId?: string }) {
  return (
    <DeckDraftProvider key={deck.id} deck={deck}>
      <Builder deck={deck} addCardId={addCardId} />
    </DeckDraftProvider>
  );
}

function Builder({ deck, addCardId }: { deck: DeckDetail; addCardId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const wide = useMediaQuery('(min-width: 1024px)');
  const widest = useMediaQuery('(min-width: 1280px)');
  const [tab, setTab] = useState<Tab>('deck');
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const [gone, setGone] = useState(false);
  const [poolElement, setPoolElement] = useState<HTMLElement | null>(null);

  const draft = useDeckDraft((s) => s.draft);
  const dirty = useDeckDraft(isDirty);
  const reset = useDeckDraft((s) => s.reset);
  const commit = useDeckDraft((s) => s.commit);
  const basis = useDeckDraft((s) => s.basis);
  const add = useDeckDraft((s) => s.add);
  const cardsById = useDeckDraft((s) => s.cardsById);
  const { validation, stats, checkingCopies } = useDeckChecks(deck.rules.deckSize);
  const save = useSaveDeck(deck.id);
  const blocker = saveBlocker(draft, dirty);
  const total = draft.cards.reduce((sum, card) => sum + card.count, 0);

  useUnsavedChanges(dirty && !gone, (leave) => setPendingLeave(() => leave), '/decks');

  // A newer server copy (another tab saved, or this page opened from a stale cache) replaces a
  // clean draft; a dirty one is the user's and stays.
  useEffect(() => {
    if (!dirty && deck.updatedAt.getTime() > basis) reset(deck);
  }, [deck, dirty, basis, reset]);

  // Once, and the parameter dropped first, so a reload or Back cannot add the copy again.
  const adding = useCard(addCardId);
  const added = useRef(false);
  useEffect(() => {
    if (added.current || addCardId === undefined || (!adding.data && !adding.isError)) return;
    added.current = true;
    window.history.replaceState(null, '', `/decks/${deck.id}`);
    if (!adding.data) {
      toastError('That card isn’t in the catalog');
      return;
    }
    const card = PlayableCardSchema.parse(adding.data);
    const refusal = addRefusal(card, draft.cards, cardsById);
    if (refusal) {
      toastError(`${card.name} not added: ${refusal}`);
      return;
    }
    add(card);
    toastSuccess(`Added ${card.name} — save the deck to keep it`);
  }, [addCardId, adding.data, adding.isError, deck.id, draft.cards, cardsById, add]);

  async function submit(thenLeave?: () => void) {
    if (blocker !== null || save.isPending) return;
    const sent = draft;
    try {
      const result = await save.mutateAsync({
        name: sent.name.trim(),
        format: sent.format,
        ownedOnly: sent.ownedOnly,
        cards: sent.cards,
      });
      queryClient.setQueryData(keys.decks.detail(deck.id), result);
      // Invalidated counts still answer from the cache at once; the verdict needs fresh ones.
      queryClient.removeQueries({ queryKey: keys.inventory.ownedAll });
      if (thenLeave) {
        thenLeave();
        return;
      }
      commit(result, result.validation, sent);
      toastSuccess(
        result.validation.valid
          ? 'Saved'
          : `Saved — not legal yet: ${failingRules(result.validation)}`,
      );
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 404) setGone(true);
      else if (error instanceof ApiError && error.statusCode === 400) toastApiError(error);
      else toastError('Couldn’t save — your changes are still here');
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 's' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void submit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const selectCard = (cardId: string) => {
    if (wide) {
      focusDeckSlot(cardId);
      return;
    }
    setTab('deck');
    requestAnimationFrame(() => requestAnimationFrame(() => focusDeckSlot(cardId)));
  };

  const showChecks = () => {
    if (!wide) setTab('check');
    requestAnimationFrame(() => document.getElementById('deck-checks')?.focus());
  };

  const pool: ReactNode = <CardPool scrollElement={wide ? poolElement : null} dragEnabled={wide} />;
  const list = (
    <div id="deck-list" tabIndex={-1} className="outline-none">
      <DeckList dragEnabled={wide} />
    </div>
  );
  const checks = (
    <DeckChecks
      validation={validation}
      stats={stats}
      checkingCopies={checkingCopies}
      onSelectCard={selectCard}
    />
  );
  const column = 'min-h-0 overflow-y-auto rounded-card border border-bd bg-surface p-4';

  return (
    <div className="flex flex-col gap-4" style={wide ? { height: BUILDER_HEIGHT } : undefined}>
      <BuilderDnd enabled={wide}>
        <BuilderHeader
          deck={deck}
          validation={validation}
          dirty={dirty}
          saving={save.isPending}
          blocker={blocker}
          onSave={() => void submit()}
          onShowChecks={showChecks}
        />
        {wide ? (
          <div
            className="grid min-h-0 flex-1 gap-4"
            style={{
              gridTemplateColumns: widest
                ? 'minmax(0, 1fr) 22.5rem 20rem'
                : 'minmax(0, 1fr) 22.5rem',
            }}
          >
            <DropZone
              id={POOL_ZONE}
              label="Card pool"
              className={column}
              onElement={setPoolElement}
            >
              {pool}
            </DropZone>
            {widest ? (
              <>
                <DropZone id={DECK_ZONE} label="Deck" className={column}>
                  {list}
                </DropZone>
                <section aria-label="Checks" className={column}>
                  {checks}
                </section>
              </>
            ) : (
              <DropZone
                id={DECK_ZONE}
                label="Deck and checks"
                className={`${column} flex flex-col gap-6`}
              >
                {list}
                {checks}
              </DropZone>
            )}
          </div>
        ) : (
          <Tabs
            label="Deck builder"
            value={tab}
            onValueChange={setTab}
            tabs={[
              { value: 'pool', label: 'Pool' },
              { value: 'deck', label: 'Deck', count: total },
              { value: 'check', label: 'Check' },
            ]}
          >
            <TabsPanel value="pool">{pool}</TabsPanel>
            <TabsPanel value="deck">{list}</TabsPanel>
            <TabsPanel value="check">{checks}</TabsPanel>
          </Tabs>
        )}
      </BuilderDnd>

      <Dialog
        open={pendingLeave !== null}
        onOpenChange={(open) => {
          if (!open && !save.isPending) setPendingLeave(null);
        }}
        tone="danger"
        icon={TriangleAlert}
        title="Leave without saving?"
        description="Your changes to this deck are not saved."
      >
        <div className="flex flex-col gap-2.5">
          <Button variant="secondary" onClick={() => setPendingLeave(null)}>
            Stay
          </Button>
          <Button
            loading={save.isPending}
            disabled={blocker !== null}
            onClick={() => {
              const leave = pendingLeave;
              if (leave) void submit(leave);
            }}
          >
            Save and leave
          </Button>
          <Button
            variant="destructive"
            icon={Trash2}
            disabled={save.isPending}
            onClick={() => {
              const leave = pendingLeave;
              setPendingLeave(null);
              leave?.();
            }}
          >
            Discard changes
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={gone}
        onOpenChange={() => {}}
        tone="danger"
        icon={TriangleAlert}
        title="This deck no longer exists"
        description="It was deleted, perhaps in another tab, so these changes cannot be saved."
        confirmLabel="Back to decks"
        onConfirm={() => router.push('/decks')}
      />
    </div>
  );
}
