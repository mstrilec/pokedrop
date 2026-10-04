import type { Card, InventoryEntry } from '@pokedrop/shared';

/** What a card component needs, whichever endpoint the card came from. */
export type CardView = {
  id: string;
  name: string;
  image: string;
  rarity: string | null;
  types: string[];
  hp: number | null;
  priceUsd: number | null;
};

type CardLike = Pick<Card, 'id' | 'name' | 'imageSmall' | 'rarity' | 'types' | 'hp'> & {
  latestPriceUsd: number | null;
};

export function cardView(card: CardLike): CardView {
  return {
    id: card.id,
    name: card.name,
    image: card.imageSmall,
    rarity: card.rarity,
    types: card.types,
    hp: card.hp,
    priceUsd: card.latestPriceUsd,
  };
}

export function inventoryCardView(entry: InventoryEntry): CardView & { owned: number } {
  return { ...cardView(entry.card), owned: entry.quantity };
}

/** `base1-4` → `BASE1 4`: the set and number printed in the corner. */
export function setNumber(id: string): string {
  const cut = id.lastIndexOf('-');
  return cut < 0 ? id.toUpperCase() : `${id.slice(0, cut).toUpperCase()} ${id.slice(cut + 1)}`;
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatUsd(price: number | null): string {
  return price === null ? '—' : usd.format(price);
}
