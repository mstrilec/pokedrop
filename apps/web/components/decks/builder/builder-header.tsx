'use client';

import {
  DECK_FORMATS,
  DECK_NAME_MAX,
  type DeckDetail,
  type DeckFormat,
  type DeckValidation,
} from '@pokedrop/shared';
import { ArrowLeft, CircleCheck, Save, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useId } from 'react';
import { FORMAT_LABELS } from '@/components/decks/deck-format';
import { NO_CHANGES } from '@/components/decks/deck-rules';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { useUpdateDeck } from '@/lib/query/decks';
import { useDeckDraft } from '@/lib/stores/deck-draft';
import { cn } from '@/lib/utils';

const MODES = [
  { ownedOnly: true, label: 'Owned only' },
  { ownedOnly: false, label: 'Theorycraft' },
] as const;

export function failingRules(validation: DeckValidation): string {
  const failing = validation.rules.filter((rule) => !rule.ok).length;
  return `${failing} ${failing === 1 ? 'rule' : 'rules'} failing`;
}

export function BuilderHeader({
  deck,
  validation,
  dirty,
  saving,
  blocker,
  onSave,
  onShowChecks,
}: {
  deck: DeckDetail;
  validation: DeckValidation;
  dirty: boolean;
  saving: boolean;
  blocker: string | null;
  onSave: () => void;
  onShowChecks: () => void;
}) {
  const draft = useDeckDraft((s) => s.draft);
  const setName = useDeckDraft((s) => s.setName);
  const setFormat = useDeckDraft((s) => s.setFormat);
  const setOwnedOnly = useDeckDraft((s) => s.setOwnedOnly);
  const update = useUpdateDeck();
  const statusId = useId();
  const { actual, expected } = validation.deckSize;

  const status =
    blocker !== null && blocker !== NO_CHANGES
      ? blocker
      : saving
        ? 'Saving…'
        : dirty
          ? 'Unsaved changes'
          : 'Saved';

  return (
    <header className="flex flex-wrap items-center gap-3 rounded-card border border-bd bg-surface p-3">
      <Button asChild variant="ghost" size="sm" icon={ArrowLeft}>
        <Link href="/decks">Decks</Link>
      </Button>
      <input
        aria-label="Deck name"
        value={draft.name}
        maxLength={DECK_NAME_MAX}
        onChange={(event) => setName(event.target.value)}
        className="focus-ring h-10 min-w-32 flex-1 basis-0 rounded-control border border-bd-2 bg-bg px-3 text-h3 font-semibold text-tx"
      />
      <select
        aria-label="Format"
        value={draft.format}
        onChange={(event) => setFormat(event.target.value as DeckFormat)}
        className="focus-ring h-10 rounded-control border border-bd-2 bg-bg px-3 text-body text-tx"
      >
        {DECK_FORMATS.map((format) => (
          <option key={format} value={format}>
            {FORMAT_LABELS[format]}
          </option>
        ))}
      </select>
      <div
        role="group"
        aria-label="Cards allowed"
        className="flex rounded-control border border-bd-2 p-0.5"
      >
        {MODES.map((mode) => (
          <button
            key={mode.label}
            type="button"
            aria-pressed={draft.ownedOnly === mode.ownedOnly}
            onClick={() => setOwnedOnly(mode.ownedOnly)}
            className={cn(
              'focus-ring h-8 cursor-pointer rounded-tag px-3 text-small font-medium text-mut transition',
              draft.ownedOnly === mode.ownedOnly && 'bg-pri-dim font-semibold text-pri',
            )}
          >
            {mode.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onShowChecks}
        aria-label={`${actual} of ${expected} cards, ${validation.valid ? 'legal' : failingRules(validation)}. Show the checks`}
        className="focus-ring cursor-pointer rounded-pill"
      >
        <Badge
          live
          tone={validation.valid ? 'success' : 'warning'}
          icon={validation.valid ? CircleCheck : TriangleAlert}
          label={`${actual}/${expected} · ${validation.valid ? 'Legal' : failingRules(validation)}`}
        />
      </button>
      <div className="ml-auto flex flex-wrap items-center gap-3">
        <Toggle
          label="Public"
          checked={deck.isPublic}
          disabled={update.isPending}
          onCheckedChange={(isPublic) => update.mutate({ id: deck.id, patch: { isPublic } })}
        />
        <span id={statusId} aria-live="polite" className="text-small text-mut">
          {status}
        </span>
        <Button
          icon={Save}
          loading={saving}
          disabled={blocker !== null}
          aria-describedby={statusId}
          onClick={onSave}
        >
          Save
        </Button>
      </div>
    </header>
  );
}
