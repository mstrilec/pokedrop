'use client';

import type { TradeDetail } from '@pokedrop/shared';
import { ArrowLeftRight, Layers, PackageOpen, Search, Swords, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { TradeStatusTimeline, tradeTimelineSteps } from '@/components/trades/trade-status-timeline';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { toastApiError, toastInfo, toastSuccess } from '@/lib/toast';
import { ApiError } from '@/lib/api/core';
import { Group, Row, Specimen } from './frame';

const AT = (m: number) => new Date(Date.UTC(2026, 9, 4, 14, m));
const party = (displayName: string) =>
  ({ id: displayName, displayName, avatarUrl: null }) as unknown as TradeDetail['initiator'];

function trade(status: TradeDetail['status'], timeline: TradeDetail['timeline']): TradeDetail {
  return {
    status,
    timeline,
    chain: [],
    counteredTradeId: null,
    role: 'recipient',
    initiator: party('MistyW'),
    recipient: party('Ash'),
  } as unknown as TradeDetail;
}

const PENDING = trade('PENDING', [
  { action: 'trade.propose', status: 'PENDING', at: AT(20), by: 'initiator' },
]);
const SETTLED = trade('ACCEPTED', [
  { action: 'trade.propose', status: 'PENDING', at: AT(20), by: 'initiator' },
  { action: 'trade.accept', status: 'ACCEPTED', at: AT(42), by: 'recipient' },
]);
const VOIDED = trade('VOIDED', [
  { action: 'trade.propose', status: 'PENDING', at: AT(20), by: 'initiator' },
  { action: 'trade.accept', status: 'ACCEPTED', at: AT(42), by: 'recipient' },
  { action: 'trade.void', status: 'VOIDED', at: AT(58), by: 'admin' },
]);

export function OverlaysSection() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  function openPack() {
    setConfirming(true);
    setTimeout(() => {
      setConfirming(false);
      setConfirmOpen(false);
      toastSuccess('Pack opened: 10 cards added to your collection', {
        label: 'View',
        onClick: () => {},
      });
    }, 1500);
  }

  return (
    <Group id="overlays" title="Overlays & feedback">
      <Specimen name="Dialog">
        <Row label="Confirm cost (opened by its trigger) · destructive (opened from code)">
          <Dialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            trigger={<Button icon={PackageOpen}>Open Astral Eclipse</Button>}
            icon={PackageOpen}
            title="Open Astral Eclipse pack?"
            description="You'll receive 10 cards with at least 1 Rare. 150 coins will be spent; this can't be undone."
            confirmLabel="Open pack · 150"
            onConfirm={openPack}
            confirming={confirming}
          />
          <Button variant="destructive" icon={Trash2} onClick={() => setDangerOpen(true)}>
            Delete deck
          </Button>
          <Dialog
            open={dangerOpen}
            onOpenChange={setDangerOpen}
            tone="danger"
            icon={Trash2}
            title="Delete “Lightning Rush”?"
            description="The deck and its 60 cards' placement go. The cards stay in your collection."
            confirmLabel="Delete deck"
            onConfirm={() => setDangerOpen(false)}
          />
        </Row>
      </Specimen>

      <Specimen name="Toast">
        <Row label="Success with an action · info · an API error (with its request ID)">
          <Button
            variant="confirm"
            onClick={() =>
              toastSuccess('Trade sent to MistyW', { label: 'Undo', onClick: () => {} })
            }
          >
            Success
          </Button>
          <Button variant="secondary" onClick={() => toastInfo('Prices refresh every night')}>
            Info
          </Button>
          <Button
            variant="destructive"
            onClick={() =>
              toastApiError(
                new ApiError({
                  kind: 'api',
                  statusCode: 402,
                  code: 'INSUFFICIENT_FUNDS',
                  message: 'Not enough coins to open this pack',
                  requestId: 'bc212513-demo',
                }),
              )
            }
          >
            Error
          </Button>
        </Row>
      </Specimen>

      <Specimen name="EmptyState">
        <div className="grid gap-4 md:grid-cols-2">
          <EmptyState
            icon={Layers}
            title="Your collection is empty"
            body="Open your first pack to start building a collection worth showing off."
            cta={{ label: 'Open a pack', icon: PackageOpen, href: '/packs' }}
          />
          <EmptyState
            icon={ArrowLeftRight}
            tone="economy"
            title="No trades yet"
            body="Find a collector on their public profile and propose your first escrow-backed trade."
            cta={{ label: 'Propose a trade', href: '/trades/new' }}
          />
          <EmptyState
            icon={Swords}
            tone="accent"
            title="No decks yet"
            body="Build a 60-card deck from the cards you own, or theorycraft with any card."
            cta={{ label: 'New deck', href: '/decks' }}
          />
          <EmptyState
            icon={Search}
            tone="neutral"
            title="No cards match"
            body="Try another spelling, or clear a filter to widen the search."
            cta={{ label: 'Clear filters', onClick: () => {} }}
          />
        </div>
      </Specimen>

      <Specimen name="TradeStatusTimeline (from TradeDetail.timeline, seen by the recipient)">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            ['Pending', PENDING],
            ['Settled', SETTLED],
            ['Voided', VOIDED],
          ].map(([name, detail]) => (
            <div key={name as string} className="rounded-card border border-bd bg-bg p-4.5">
              <h4 className="mb-4 text-small font-semibold">{name as string}</h4>
              <TradeStatusTimeline
                steps={tradeTimelineSteps(detail as TradeDetail)}
                label={`${name as string} trade status`}
              />
            </div>
          ))}
        </div>
      </Specimen>
    </Group>
  );
}
