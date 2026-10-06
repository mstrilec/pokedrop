'use client';

import { packRates, type SlotConfig, slotOdds } from '@pokedrop/shared';

// One decimal from 1% up, two below it: 10.0%, 2.7%, 0.40%.
const pct = (share: number) => {
  const value = share * 100;
  return `${value.toFixed(value >= 1 || value === 0 ? 1 : 2)}%`;
};

/**
 * The generator's own arithmetic (`slotOdds`, `packRates` from `@pokedrop/shared`): each card is
 * one draw by cumulative weight, every draw independent.
 */
export function OddsPreview({ slots }: { slots: SlotConfig['slots'] }) {
  if (slots.length === 0) {
    return (
      <p className="text-small text-mut">
        The preview appears once a slot has a count and a positive weight.
      </p>
    );
  }
  const perSlot = slotOdds(slots);
  const rates = packRates(slots);
  const cards = slots.reduce((sum, slot) => sum + slot.count, 0);

  return (
    <div className="flex flex-col gap-4">
      <table className="w-full text-left text-small">
        <caption className="mb-2 text-left text-mut">
          A pack of {cards} {cards === 1 ? 'card' : 'cards'} — what an average pack holds
        </caption>
        <thead className="text-mut">
          <tr>
            <th scope="col" className="pb-2 font-medium">
              Rarity
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              Per pack
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              At least one
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-bd font-mono">
          {rates.map((rate) => (
            <tr key={rate.rarity}>
              <th scope="row" className="py-1.5 font-sans font-normal text-tx">
                {rate.rarity}
              </th>
              <td className="py-1.5 text-right text-tx">{rate.expected.toFixed(2)}</td>
              <td className="py-1.5 text-right text-tx">{pct(rate.atLeastOne)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ol className="flex flex-col gap-1.5 text-small">
        {perSlot.map((slot, i) => (
          <li key={i} className="text-mut">
            <span className="text-tx">
              Slot {i + 1} · {slot.count} {slot.count === 1 ? 'card' : 'cards'}:
            </span>{' '}
            {slot.odds.map((o) => `${o.rarity} ${pct(o.share)}`).join(', ')}
          </li>
        ))}
      </ol>
    </div>
  );
}
