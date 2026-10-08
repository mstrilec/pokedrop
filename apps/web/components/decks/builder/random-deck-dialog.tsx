'use client';

import {
  type BasicEnergyType,
  DECK_FORMATS,
  type DeckFormat,
  type RandomDeckShortfall,
} from '@pokedrop/shared';
import { CircleAlert, Shuffle, Sparkles } from 'lucide-react';
import { useId, useState } from 'react';
import { FORMAT_LABELS } from '@/components/decks/deck-format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { energyStyle } from '@/lib/design/energy';
import { useRandomDeck, useRandomDeckTypes } from '@/lib/query/decks';
import { useDeckDraft } from '@/lib/stores/deck-draft';
import { toastApiError, toastSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';

const chip =
  'focus-ring inline-flex cursor-pointer items-center gap-1.5 rounded-pill border px-3 py-1.5 text-small transition';
const chipOn = 'border-pri bg-pri-dim text-tx';
const chipOff = 'border-bd-2 text-mut hover:text-tx';

/** Fills the draft with a generated legal deck; the member saves it. */
export function RandomDeckDialog({
  open,
  onClose,
  format: initialFormat,
  ownedOnly: initialOwnedOnly,
}: {
  open: boolean;
  onClose: () => void;
  format: DeckFormat;
  ownedOnly: boolean;
}) {
  const formatId = useId();
  const cardsInDraft = useDeckDraft((s) => s.draft.cards.reduce((n, c) => n + c.count, 0));
  const replaceCards = useDeckDraft((s) => s.replaceCards);
  const typesByFormat = useRandomDeckTypes();
  const generate = useRandomDeck();
  const [format, setFormat] = useState(initialFormat);
  const [ownedOnly, setOwnedOnly] = useState(initialOwnedOnly);
  const [types, setTypes] = useState<BasicEnergyType[]>([]);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [shortfall, setShortfall] = useState<RandomDeckShortfall | null>(null);
  const available = typesByFormat.data?.[format] ?? [];

  const close = () => {
    setConfirmReplace(false);
    setShortfall(null);
    onClose();
  };

  const toggle = (type: BasicEnergyType) => {
    setShortfall(null);
    setTypes((current) =>
      current.includes(type)
        ? current.filter((t) => t !== type)
        : current.length < 2
          ? [...current, type]
          : [current[1]!, type],
    );
  };

  async function run(owned: boolean) {
    setShortfall(null);
    try {
      const answer = await generate.mutateAsync({
        format,
        ownedOnly: owned,
        types: types.filter((type) => available.includes(type)),
      });
      if (answer.result === 'shortfall') {
        setConfirmReplace(false);
        setShortfall(answer);
        return;
      }
      replaceCards(answer.cards, { format: answer.format, ownedOnly: owned });
      toastSuccess(`Random ${answer.types.join(' · ')} deck added — save it to keep it`);
      close();
    } catch (error) {
      setConfirmReplace(false);
      toastApiError(error);
    }
  }

  const confirm = () => {
    if (cardsInDraft > 0 && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }
    void run(ownedOnly);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      icon={Shuffle}
      title="Random deck"
      description="A legal deck of whole evolution lines, Trainers and basic Energy. It replaces the deck's cards; nothing is saved until you save."
      confirmLabel={confirmReplace ? 'Replace' : 'Generate'}
      cancelLabel={confirmReplace ? 'Keep them' : 'Cancel'}
      onConfirm={confirm}
      confirming={generate.isPending}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={formatId} className="text-small text-mut">
            Format
          </label>
          <select
            id={formatId}
            value={format}
            onChange={(event) => {
              setFormat(event.target.value as DeckFormat);
              setShortfall(null);
            }}
            className="focus-ring h-10 rounded-control border border-bd-2 bg-bg px-3 text-body text-tx"
          >
            {DECK_FORMATS.map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABELS[f]}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-small text-mut">Cards</legend>
          <div className="flex flex-wrap gap-2">
            {[
              { value: true, label: 'Owned only' },
              { value: false, label: 'Any card' },
            ].map((option) => (
              <label
                key={option.label}
                className={cn(chip, ownedOnly === option.value ? chipOn : chipOff)}
              >
                <input
                  type="radio"
                  name="random-cards"
                  className="sr-only"
                  checked={ownedOnly === option.value}
                  onChange={() => {
                    setOwnedOnly(option.value);
                    setShortfall(null);
                  }}
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-small text-mut">Energy (up to two types)</legend>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={types.length === 0}
              onClick={() => setTypes([])}
              className={cn(chip, types.length === 0 ? chipOn : chipOff)}
            >
              <Sparkles aria-hidden className="size-3.5" />
              Surprise me
            </button>
            {available.map((type) => {
              const style = energyStyle(type);
              const Icon = style.icon;
              const on = types.includes(type);
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(type)}
                  className={cn(chip, on ? chipOn : chipOff)}
                >
                  <Icon aria-hidden className={cn('size-3.5', style.text)} />
                  {type}
                </button>
              );
            })}
          </div>
        </fieldset>

        {confirmReplace ? (
          <p role="status" className="text-body text-tx">
            Replace the {cardsInDraft} {cardsInDraft === 1 ? 'card' : 'cards'} in this deck?
          </p>
        ) : null}

        {shortfall ? (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-control border border-gold/30 bg-surface p-3"
          >
            <p className="flex items-start gap-2 text-small text-tx">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-gold" />
              {shortfall.message}
            </p>
            {ownedOnly ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="self-start"
                loading={generate.isPending}
                onClick={() => {
                  setOwnedOnly(false);
                  void run(false);
                }}
              >
                Use any card instead
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
