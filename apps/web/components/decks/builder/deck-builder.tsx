'use client';

import type { DeckDetail } from '@pokedrop/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Trash2, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { saveBlocker } from '@/components/decks/deck-rules';
import { focusDeckSlot } from '@/components/decks/deck-slot';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Tabs, TabsPanel } from '@/components/ui/tabs';
import { ApiError } from '@/lib/api/core';
import { useSaveDeck } from '@/lib/query/decks';
import { keys } from '@/lib/query/keys';
import { DeckDraftProvider, isDirty, useDeckDraft } from '@/lib/stores/deck-draft';
import { toastApiError, toastError, toastSuccess } from '@/lib/toast';
import { useMediaQuery } from '@/lib/use-media-query';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { BuilderHeader, failingRules } from './builder-header';
import { DeckChecks } from './deck-checks';
import { DeckList } from './deck-list';
import { useDeckChecks } from './use-deck-checks';

type Tab = 'pool' | 'deck' | 'check';

// Below the 60 px topbar and the main element's 2 × 32 px padding.
const BUILDER_HEIGHT = 'calc(100dvh - 3.75rem - 4rem)';

/** The store takes the first `deck` only; later answers (a Public flip refetches) never reset it. */
export function DeckBuilder({ deck }: { deck: DeckDetail }) {
  return (
    <DeckDraftProvider key={deck.id} deck={deck}>
      <Builder deck={deck} />
    </DeckDraftProvider>
  );
}

function Builder({ deck }: { deck: DeckDetail }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const wide = useMediaQuery('(min-width: 1024px)');
  const widest = useMediaQuery('(min-width: 1280px)');
  const [tab, setTab] = useState<Tab>('deck');
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const [gone, setGone] = useState(false);

  const draft = useDeckDraft((s) => s.draft);
  const dirty = useDeckDraft(isDirty);
  const reset = useDeckDraft((s) => s.reset);
  const { validation, stats, checkingCopies } = useDeckChecks(deck.rules.deckSize);
  const save = useSaveDeck(deck.id);
  const blocker = saveBlocker(draft, dirty);
  const total = draft.cards.reduce((sum, card) => sum + card.count, 0);

  useUnsavedChanges(dirty && !gone, (leave) => setPendingLeave(() => leave));

  async function submit(thenLeave?: () => void) {
    if (blocker !== null || save.isPending) return;
    try {
      const result = await save.mutateAsync({
        name: draft.name.trim(),
        format: draft.format,
        ownedOnly: draft.ownedOnly,
        cards: draft.cards,
      });
      queryClient.setQueryData(keys.decks.detail(deck.id), result);
      if (thenLeave) {
        thenLeave();
        return;
      }
      reset(result, result.validation);
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

  const pool: ReactNode = null;
  const list = (
    <div id="deck-list" tabIndex={-1} className="outline-none">
      <DeckList />
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
            gridTemplateColumns: widest ? 'minmax(0, 1fr) 22.5rem 20rem' : 'minmax(0, 1fr) 22.5rem',
          }}
        >
          <section aria-label="Card pool" className={column}>
            {pool}
          </section>
          {widest ? (
            <>
              <section aria-label="Deck" className={column}>
                {list}
              </section>
              <section aria-label="Checks" className={column}>
                {checks}
              </section>
            </>
          ) : (
            <section aria-label="Deck and checks" className={`${column} flex flex-col gap-6`}>
              {list}
              {checks}
            </section>
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
