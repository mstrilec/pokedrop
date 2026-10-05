'use client';

import { ERROR_CODES, type InventoryCard } from '@pokedrop/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Info, Trash2, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useEffect, useMemo, useReducer, useState } from 'react';
import { cardView } from '@/components/cards/card-data';
import { ListError } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/core';
import { ownedCounts } from '@/lib/api/endpoints/inventory';
import { useCard } from '@/lib/query/catalog';
import { useOwnedCounts } from '@/lib/query/inventory';
import { keys } from '@/lib/query/keys';
import { useMe } from '@/lib/query/me';
import { useCounterTrade, useProposeTrade, useTrade } from '@/lib/query/trades';
import { useProfile } from '@/lib/query/users';
import { toastApiError, toastSuccess } from '@/lib/toast';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { TradeOfferPanel } from '../trade-offer-panel';
import { CardPickerDialog } from './card-picker-dialog';
import {
  composeProblems,
  type ComposerState,
  composerReducer,
  initialState,
  type Side,
  termsOf,
} from './composer-state';
import { CounterpartyPicker } from './counterparty-picker';
import { TradeReview } from './trade-review';

const is404 = (error: unknown) => error instanceof ApiError && error.statusCode === 404;

/** Waits for what `?to=`, `?card=` and `?counter=` name, then mounts the composer with it. */
export function TradeComposerPage({
  to,
  card,
  counter,
}: {
  to?: string;
  card?: string;
  counter?: string;
}) {
  const me = useMe();
  const profile = useProfile(counter ? undefined : to);
  const cardQuery = useCard(counter ? undefined : card);
  const trade = useTrade(counter);

  if (me.isError) return <ListError error={me.error} onRetry={() => void me.refetch()} />;
  if (me.isPending || profile.isLoading || cardQuery.isLoading || trade.isLoading) {
    return <Skeleton shape="block" height="24rem" />;
  }
  for (const query of [profile, cardQuery, trade]) {
    if (query.isError && !is404(query.error)) {
      return <ListError error={query.error} onRetry={() => void query.refetch()} />;
    }
  }

  const { state, notices, blocked } = initialState({
    meId: me.data.id,
    to: !counter && to ? { profile: profile.data, missing: profile.isError } : undefined,
    card: !counter && card ? { card: cardQuery.data, missing: cardQuery.isError } : undefined,
    counter: counter ? { trade: trade.data, missing: trade.isError } : undefined,
  });

  if (blocked) {
    return (
      <>
        <PageHeader title="Counter an offer" />
        <p className="flex items-center gap-2 text-body text-mut">
          <Info aria-hidden className="size-4" />
          {blocked}{' '}
          <Link href="/trades" className="focus-ring rounded-tag text-pri hover:underline">
            Back to your trades
          </Link>
        </p>
      </>
    );
  }
  return <TradeComposer initial={state} notices={notices} meId={me.data.id} />;
}

function TradeComposer({
  initial,
  notices,
  meId,
}: {
  initial: ComposerState;
  notices: string[];
  meId: string;
}) {
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(composerReducer, initial);
  const [picker, setPicker] = useState<Side | null>(null);
  const [notice, setNotice] = useState<ReactNode>(notices.length > 0 ? notices.join(' ') : null);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const me = useMe();
  const profile = useProfile(state.counterparty?.id);
  const propose = useProposeTrade();
  const counter = useCounterTrade();
  const sending = propose.isPending || counter.isPending;

  const giveIds = useMemo(() => state.give.map((line) => line.card.id).sort(), [state.give]);
  const { owned, known } = useOwnedCounts(giveIds.length > 0 ? [giveIds] : [], true);
  const available = (cardId: string) =>
    known.has(cardId) ? (owned.get(cardId)?.available ?? 0) : undefined;
  const problems = composeProblems(state, { meId, balance: me.data?.currency, available });

  const name = state.counterparty?.displayName ?? 'They';
  // Changed by the user, not merely non-empty: a pre-filled composer is not dirty on mount, so
  // the guard never installs during React Strict Mode's mount–unmount–mount (Pages.md, traps).
  const dirty =
    state.give !== initial.give ||
    state.get !== initial.get ||
    state.coinsGive !== initial.coinsGive ||
    state.coinsGet !== initial.coinsGet;
  const leaveTo = useUnsavedChanges(dirty, (leave) => setPendingLeave(() => leave), '/trades');

  const lineProblem = (line: { card: InventoryCard; count: number }) => {
    const have = available(line.card.id);
    if (have === undefined || line.count <= have) return undefined;
    return have === 0 ? 'No copies available now' : `Only ${have} available now`;
  };

  // Back from another tab, where a trade may have locked or released copies: count them again.
  useEffect(() => {
    const onFocus = () => void queryClient.invalidateQueries({ queryKey: keys.inventory.ownedAll });
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [queryClient]);

  // The cached counts may be minutes old; a copy locked from another tab must show before Review.
  async function review() {
    if (giveIds.length > 0) {
      const fresh = await queryClient.fetchQuery({
        queryKey: keys.inventory.owned(giveIds),
        queryFn: () => api.call(ownedCounts(giveIds)),
        staleTime: 0,
      });
      const now = new Map<string, number>(fresh.map((row) => [row.cardId, row.availableQuantity]));
      const balance = me.data?.currency;
      if (
        composeProblems(state, { meId, balance, available: (id) => now.get(id) ?? 0 }).length > 0
      ) {
        return;
      }
    }
    dispatch({ type: 'step', step: 'review' });
  }

  async function send() {
    const body = termsOf(state);
    try {
      if (state.mode === 'counter' && state.counteredId) {
        await counter.mutateAsync({ id: state.counteredId, body });
      } else if (state.counterparty) {
        await propose.mutateAsync({ ...body, recipientId: state.counterparty.id });
      }
      toastSuccess(
        state.mode === 'counter' ? `Counter-offer sent to ${name}` : `Offer sent to ${name}`,
      );
      leaveTo('/trades?tab=sent');
    } catch (error) {
      dispatch({ type: 'step', step: 'compose' });
      if (error instanceof ApiError && error.code === ERROR_CODES.CARDS_UNAVAILABLE) {
        setNotice(
          'Some of your copies were locked by another trade meanwhile — lower the marked lines.',
        );
        void queryClient.invalidateQueries({ queryKey: keys.inventory.ownedAll });
      } else if (error instanceof ApiError && error.statusCode === 402) {
        setNotice('You don’t have that many coins any more.');
        void queryClient.invalidateQueries({ queryKey: keys.me });
      } else if (error instanceof ApiError && error.code === ERROR_CODES.TRADE_NOT_PENDING) {
        setNotice(
          <>
            {name}’s offer was already answered.{' '}
            <Link href="/trades" className="text-pri hover:underline">
              Back to your trades
            </Link>
          </>,
        );
      } else {
        toastApiError(error);
      }
    }
  }

  const title = state.mode === 'counter' ? `Counter ${name}’s offer` : 'Propose a trade';

  return (
    <>
      <Breadcrumbs
        trail={[
          { label: 'Trades', href: '/trades' },
          { label: state.mode === 'counter' ? 'Counter-offer' : 'New proposal' },
        ]}
        className="mb-4"
      />
      <PageHeader
        title={title}
        description="Pick a collector, then build the offer. The cards you offer lock when you send it."
      />
      {notice ? (
        <p
          role="status"
          className="mb-5 flex items-start gap-2 rounded-control border border-gold/30 bg-surface p-3 text-small text-tx"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-gold" />
          <span>{notice}</span>
        </p>
      ) : null}

      {state.step === 'review' ? (
        <TradeReview
          state={state}
          sending={sending}
          onBack={() => dispatch({ type: 'step', step: 'compose' })}
          onSend={() => void send()}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="max-w-110">
            <CounterpartyPicker
              value={state.counterparty}
              onChange={(party) => dispatch({ type: 'counterparty', party })}
              locked={state.mode === 'counter'}
            />
          </div>
          <TradeOfferPanel
            editable
            balance={me.data?.currency}
            give={{
              label: 'You give',
              coins: state.coinsGive,
              cards: state.give.map((line) => ({
                card: cardView(line.card),
                count: line.count,
                max: available(line.card.id),
                problem: lineProblem(line),
              })),
            }}
            get={{
              label: state.counterparty ? `${name} gives` : 'They give',
              coins: state.coinsGet,
              cards: state.get.map((line) => ({ card: cardView(line.card), count: line.count })),
            }}
            onAddCard={(side) => setPicker(side)}
            onRemoveCard={(side, cardId) => dispatch({ type: 'remove', side, cardId })}
            onCountChange={(side, cardId, count) =>
              dispatch({ type: 'count', side, cardId, count })
            }
            onCoinsChange={(side, coins) => dispatch({ type: 'coins', side, coins })}
          />
          <div className="flex flex-wrap items-center justify-end gap-3">
            {problems.length > 0 ? (
              <p id="compose-problem" className="text-small text-mut">
                {problems[0]}
              </p>
            ) : null}
            <Button asChild variant="ghost">
              <Link href="/trades">Cancel</Link>
            </Button>
            <Button
              icon={ArrowRight}
              disabled={problems.length > 0}
              aria-describedby={problems.length > 0 ? 'compose-problem' : undefined}
              onClick={() => void review()}
            >
              Review offer
            </Button>
          </div>
        </div>
      )}

      <CardPickerDialog
        side={picker}
        state={state}
        counterpartyName={name}
        showcase={profile.data?.showcase ?? []}
        onPick={(side, card) => dispatch({ type: 'add', side, card })}
        onClose={() => setPicker(null)}
      />
      <Dialog
        open={pendingLeave !== null}
        onOpenChange={(open) => {
          if (!open) setPendingLeave(null);
        }}
        tone="danger"
        icon={TriangleAlert}
        title="Leave this offer?"
        description="Nothing has been sent; the offer you were building will be lost."
      >
        <div className="flex flex-col gap-2.5">
          <Button variant="secondary" onClick={() => setPendingLeave(null)}>
            Stay
          </Button>
          <Button
            variant="destructive"
            icon={Trash2}
            onClick={() => {
              const leave = pendingLeave;
              setPendingLeave(null);
              leave?.();
            }}
          >
            Discard the offer
          </Button>
        </div>
      </Dialog>
    </>
  );
}
