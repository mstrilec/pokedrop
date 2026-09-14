import { RarityTierSchema, type Card, type RarityTier } from '@pokedrop/shared';

/**
 * Placeholder home page. The real landing page is PD-101.
 *
 * It consumes contracts from @pokedrop/shared so that a broken cross-package
 * type fails `pnpm typecheck` rather than surfacing later in a browser.
 */
function cardLabel(card: Pick<Card, 'name' | 'rarity'>): string {
  return `${card.name} — ${card.rarity ?? 'unknown rarity'}`;
}

export default function Home() {
  const tiers: readonly RarityTier[] = RarityTierSchema.options;
  const sample = cardLabel({ name: 'Charizard', rarity: 'Rare Holo' });

  return (
    <main style={{ padding: '2rem', fontFamily: 'var(--font-geist-sans)' }}>
      <h1>PokéDrop</h1>
      <p>Workspace scaffolding is in place. Pages land in PD-101 and later.</p>
      <p>
        Rarity ramp from <code>@pokedrop/shared</code>: {tiers.join(', ')}
      </p>
      <p>
        Sample label: <code>{sample}</code>
      </p>
    </main>
  );
}
