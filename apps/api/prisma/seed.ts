/**
 * Development seed.
 *
 * Deliberately small and hand-written rather than generated. Faker factories
 * shared with integration tests were the original plan, but there are no tests
 * during v1 and most of the features this data would exercise do not exist yet
 * — a factory layer built now would be written against guesses. This covers
 * what M2 and M3 actually need to develop against, and grows when there is
 * something to grow for.
 *
 * Idempotent: every row has a fixed id, and the script removes its own rows
 * before inserting. It never touches rows it did not create.
 *
 * Run with `pnpm --filter @pokedrop/api db:seed`. Node executes TypeScript
 * directly, so there is no build step and no tsx dependency.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const rootEnv = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env');

if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env at the repository root.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

// ---------------------------------------------------------------------------
// Catalog
//
// Ids follow the provider's shape (`base1`, `base1-4`) rather than a seed
// prefix, so a later real sync upserts over them instead of leaving duplicates
// beside them.
// ---------------------------------------------------------------------------

const SETS = [
  { id: 'base1', name: 'Base Set', series: 'Base', releaseDate: '1999-01-09', printedTotal: 102 },
  { id: 'base2', name: 'Jungle', series: 'Base', releaseDate: '1999-06-16', printedTotal: 64 },
  {
    id: 'sv1',
    name: 'Scarlet & Violet',
    series: 'Scarlet & Violet',
    releaseDate: '2023-03-31',
    printedTotal: 198,
  },
] as const;

/** One card per step of the rarity ramp, so a pack can pull from every slot. */
const CARDS = [
  {
    id: 'base1-4',
    setId: 'base1',
    name: 'Charizard',
    rarity: 'Rare Holo',
    types: ['Fire'],
    hp: 120,
    usd: '312.45',
  },
  {
    id: 'base1-2',
    setId: 'base1',
    name: 'Blastoise',
    rarity: 'Rare Holo',
    types: ['Water'],
    hp: 100,
    usd: '188.20',
  },
  {
    id: 'base1-15',
    setId: 'base1',
    name: 'Venusaur',
    rarity: 'Rare Holo',
    types: ['Grass'],
    hp: 100,
    usd: '142.00',
  },
  {
    id: 'base1-58',
    setId: 'base1',
    name: 'Pikachu',
    rarity: 'Common',
    types: ['Lightning'],
    hp: 40,
    usd: '8.75',
  },
  {
    id: 'base1-46',
    setId: 'base1',
    name: 'Charmander',
    rarity: 'Common',
    types: ['Fire'],
    hp: 50,
    usd: '12.30',
  },
  {
    id: 'base1-63',
    setId: 'base1',
    name: 'Squirtle',
    rarity: 'Common',
    types: ['Water'],
    hp: 40,
    usd: '9.10',
  },
  {
    id: 'base2-10',
    setId: 'base2',
    name: 'Snorlax',
    rarity: 'Rare Holo',
    types: ['Colorless'],
    hp: 90,
    usd: '64.00',
  },
  {
    id: 'base2-33',
    setId: 'base2',
    name: 'Eevee',
    rarity: 'Common',
    types: ['Colorless'],
    hp: 50,
    usd: '3.40',
  },
  {
    id: 'base2-24',
    setId: 'base2',
    name: 'Scyther',
    rarity: 'Uncommon',
    types: ['Grass'],
    hp: 70,
    usd: '15.60',
  },
  {
    id: 'sv1-245',
    setId: 'sv1',
    name: 'Miriam',
    rarity: 'Rare Ultra',
    types: [],
    hp: null,
    usd: '21.80',
  },
  {
    id: 'sv1-198',
    setId: 'sv1',
    name: 'Gardevoir ex',
    rarity: 'Rare Secret',
    types: ['Psychic'],
    hp: 310,
    usd: '48.90',
  },
  {
    id: 'sv1-76',
    setId: 'sv1',
    name: 'Magnemite',
    rarity: 'Uncommon',
    types: ['Lightning'],
    hp: 60,
    usd: '1.20',
  },
] as const;

const CARD_IDS = CARDS.map((card) => card.id);
const SET_IDS = SETS.map((set) => set.id);

// ---------------------------------------------------------------------------
// People and money
//
// `currency` is never written directly. Each user's balance is the sum of the
// ledger rows below it, computed here, because nothing in the schema keeps the
// denormalised balance and the ledger in agreement — and seed data that starts
// out disagreeing poisons every later check of the economy.
// ---------------------------------------------------------------------------

type LedgerEntry = {
  id: string;
  amount: number;
  type: 'GRANT' | 'PACK_SPEND' | 'TRADE';
  refId: string | null;
};

const USERS = [
  {
    id: 'seed-admin',
    email: 'admin@pokedrop.test',
    displayName: 'Professor Oak',
    role: 'ADMIN' as const,
    ledger: [{ id: 'seed-tx-admin-1', amount: 10_000, type: 'GRANT' as const, refId: null }],
  },
  {
    id: 'seed-ash',
    email: 'ash@pokedrop.test',
    displayName: 'Ash',
    role: 'MEMBER' as const,
    ledger: [
      { id: 'seed-tx-ash-1', amount: 1_000, type: 'GRANT' as const, refId: null },
      { id: 'seed-tx-ash-2', amount: 500, type: 'GRANT' as const, refId: null },
      { id: 'seed-tx-ash-3', amount: -300, type: 'PACK_SPEND' as const, refId: 'seed-open-1' },
    ],
  },
  {
    id: 'seed-misty',
    email: 'misty@pokedrop.test',
    displayName: 'Misty',
    role: 'MEMBER' as const,
    ledger: [
      { id: 'seed-tx-misty-1', amount: 1_000, type: 'GRANT' as const, refId: null },
      { id: 'seed-tx-misty-2', amount: -200, type: 'TRADE' as const, refId: 'seed-trade-accepted' },
    ],
  },
  {
    id: 'seed-brock',
    email: 'brock@pokedrop.test',
    displayName: 'Brock',
    role: 'MEMBER' as const,
    ledger: [
      { id: 'seed-tx-brock-1', amount: 1_000, type: 'GRANT' as const, refId: null },
      { id: 'seed-tx-brock-2', amount: 200, type: 'TRADE' as const, refId: 'seed-trade-accepted' },
    ],
  },
  {
    /** No grant at all: the empty-wallet case every balance check should meet. */
    id: 'seed-gary',
    email: 'gary@pokedrop.test',
    displayName: 'Gary',
    role: 'MEMBER' as const,
    ledger: [] as LedgerEntry[],
  },
] as const;

const balanceOf = (ledger: readonly LedgerEntry[]): number =>
  ledger.reduce((total, entry) => total + entry.amount, 0);

// ---------------------------------------------------------------------------
// Trades — one per TradeStatus, plus the counter-offer chain
// ---------------------------------------------------------------------------

const TRADES = [
  {
    id: 'seed-trade-pending',
    initiatorId: 'seed-ash',
    recipientId: 'seed-misty',
    status: 'PENDING' as const,
    resolvedAt: null,
    counteredTradeId: null,
    currencyFromInitiator: 0,
    currencyFromRecipient: 0,
    /** Backed by the lock on Ash's Charizard below. */
    items: [
      { id: 'seed-ti-1', side: 'OFFERED' as const, cardId: 'base1-4', quantity: 1 },
      { id: 'seed-ti-2', side: 'REQUESTED' as const, cardId: 'base1-2', quantity: 1 },
    ],
  },
  {
    id: 'seed-trade-accepted',
    initiatorId: 'seed-misty',
    recipientId: 'seed-brock',
    status: 'ACCEPTED' as const,
    resolvedAt: new Date('2026-09-10T12:00:00Z'),
    counteredTradeId: null,
    currencyFromInitiator: 200,
    currencyFromRecipient: 0,
    items: [{ id: 'seed-ti-3', side: 'REQUESTED' as const, cardId: 'base2-10', quantity: 1 }],
  },
  {
    id: 'seed-trade-declined',
    initiatorId: 'seed-brock',
    recipientId: 'seed-ash',
    status: 'DECLINED' as const,
    resolvedAt: new Date('2026-09-11T09:30:00Z'),
    counteredTradeId: null,
    currencyFromInitiator: 0,
    currencyFromRecipient: 0,
    items: [{ id: 'seed-ti-4', side: 'OFFERED' as const, cardId: 'base2-33', quantity: 2 }],
  },
  {
    id: 'seed-trade-countered',
    initiatorId: 'seed-gary',
    recipientId: 'seed-ash',
    status: 'COUNTERED' as const,
    resolvedAt: new Date('2026-09-12T18:00:00Z'),
    counteredTradeId: null,
    currencyFromInitiator: 0,
    currencyFromRecipient: 0,
    items: [{ id: 'seed-ti-5', side: 'REQUESTED' as const, cardId: 'sv1-198', quantity: 1 }],
  },
  {
    /** The counter to the one above — this is what makes the chain walkable. */
    id: 'seed-trade-cancelled',
    initiatorId: 'seed-ash',
    recipientId: 'seed-gary',
    status: 'CANCELLED' as const,
    resolvedAt: new Date('2026-09-13T08:15:00Z'),
    counteredTradeId: 'seed-trade-countered',
    currencyFromInitiator: 0,
    currencyFromRecipient: 150,
    items: [{ id: 'seed-ti-6', side: 'OFFERED' as const, cardId: 'sv1-198', quantity: 1 }],
  },
  {
    id: 'seed-trade-voided',
    initiatorId: 'seed-gary',
    recipientId: 'seed-brock',
    status: 'VOIDED' as const,
    resolvedAt: new Date('2026-09-14T22:45:00Z'),
    counteredTradeId: null,
    currencyFromInitiator: 0,
    currencyFromRecipient: 0,
    items: [{ id: 'seed-ti-7', side: 'OFFERED' as const, cardId: 'base1-58', quantity: 3 }],
  },
] as const;

async function clear(): Promise<void> {
  // Order matters: the catalog is Restrict, so everything referencing a card
  // has to go before the cards do.
  await prisma.tradeItem.deleteMany({ where: { id: { startsWith: 'seed-' } } });
  await prisma.trade.deleteMany({ where: { id: { startsWith: 'seed-' } } });
  await prisma.deckCard.deleteMany({ where: { id: { startsWith: 'seed-' } } });
  await prisma.deck.deleteMany({ where: { id: { startsWith: 'seed-' } } });
  await prisma.packOpeningCard.deleteMany({ where: { id: { startsWith: 'seed-' } } });
  await prisma.packOpening.deleteMany({ where: { id: { startsWith: 'seed-' } } });
  await prisma.currencyTransaction.deleteMany({ where: { id: { startsWith: 'seed-' } } });
  await prisma.inventoryItem.deleteMany({ where: { id: { startsWith: 'seed-' } } });
  await prisma.notification.deleteMany({ where: { id: { startsWith: 'seed-' } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'seed-' } } });
  await prisma.packTemplate.deleteMany({ where: { id: { startsWith: 'seed-' } } });
  await prisma.card.deleteMany({ where: { id: { in: [...CARD_IDS] } } });
  await prisma.cardSet.deleteMany({ where: { id: { in: [...SET_IDS] } } });
}

async function seed(): Promise<void> {
  await clear();

  await prisma.cardSet.createMany({
    data: SETS.map((set) => ({
      id: set.id,
      name: set.name,
      series: set.series,
      releaseDate: new Date(set.releaseDate),
      printedTotal: set.printedTotal,
      total: set.printedTotal,
      symbolUrl: `https://images.pokemontcg.io/${set.id}/symbol.png`,
      logoUrl: `https://images.pokemontcg.io/${set.id}/logo.png`,
    })),
  });

  await prisma.card.createMany({
    data: CARDS.map((card) => ({
      id: card.id,
      setId: card.setId,
      name: card.name,
      supertype: card.types.length > 0 ? 'Pokémon' : 'Trainer',
      subtypes: ['Basic'],
      hp: card.hp,
      types: [...card.types],
      rarity: card.rarity,
      retreatCost: ['Colorless'],
      weaknesses: [],
      resistances: [],
      attacks: [],
      abilities: [],
      legalities: { unlimited: 'Legal' },
      nationalPokedexNumbers: [],
      imageSmall: `https://images.pokemontcg.io/${card.id}.png`,
      imageLarge: `https://images.pokemontcg.io/${card.id}_hires.png`,
      latestPriceUsd: card.usd,
      priceUpdatedAt: new Date('2026-09-15T03:00:00Z'),
    })),
  });

  await prisma.user.createMany({
    data: USERS.map((user) => ({
      id: user.id,
      email: user.email,
      emailVerified: true,
      displayName: user.displayName,
      role: user.role,
      currency: balanceOf(user.ledger),
    })),
  });

  await prisma.currencyTransaction.createMany({
    data: USERS.flatMap((user) =>
      user.ledger.map((entry) => ({
        id: entry.id,
        userId: user.id,
        amount: entry.amount,
        type: entry.type,
        refId: entry.refId,
      })),
    ),
  });

  await prisma.packTemplate.create({
    data: {
      id: 'seed-template-base',
      name: 'Base Set Booster',
      setFilter: { setIds: ['base1', 'base2'] },
      cost: 300,
      // The shape documented in docs/UserFlows.md section 5.
      slotConfig: {
        slots: [
          { count: 4, weights: { Common: 100 } },
          { count: 3, weights: { Uncommon: 100 } },
          {
            count: 1,
            weights: { Rare: 72, 'Rare Holo': 20, 'Rare Ultra': 7, 'Rare Secret': 1 },
          },
        ],
      },
      active: true,
    },
  });

  await prisma.inventoryItem.createMany({
    data: [
      // Charizard is locked because seed-trade-pending offers it. This is the
      // escrow invariant in the seed rather than only in a test.
      { id: 'seed-inv-1', userId: 'seed-ash', cardId: 'base1-4', quantity: 2, lockedQuantity: 1 },
      { id: 'seed-inv-2', userId: 'seed-ash', cardId: 'base1-58', quantity: 5, lockedQuantity: 0 },
      { id: 'seed-inv-3', userId: 'seed-ash', cardId: 'base1-46', quantity: 3, lockedQuantity: 0 },
      { id: 'seed-inv-4', userId: 'seed-misty', cardId: 'base1-2', quantity: 1, lockedQuantity: 0 },
      {
        id: 'seed-inv-5',
        userId: 'seed-misty',
        cardId: 'base1-63',
        quantity: 4,
        lockedQuantity: 0,
      },
      {
        id: 'seed-inv-6',
        userId: 'seed-brock',
        cardId: 'base2-10',
        quantity: 1,
        lockedQuantity: 0,
      },
      { id: 'seed-inv-7', userId: 'seed-gary', cardId: 'sv1-198', quantity: 1, lockedQuantity: 0 },
    ],
  });

  await prisma.packOpening.create({
    data: {
      id: 'seed-open-1',
      userId: 'seed-ash',
      templateId: 'seed-template-base',
      openId: 'seed-open-id-0001',
      cards: {
        create: [
          { id: 'seed-poc-1', cardId: 'base1-58', rarity: 'Common' },
          { id: 'seed-poc-2', cardId: 'base1-46', rarity: 'Common' },
          { id: 'seed-poc-3', cardId: 'base2-24', rarity: 'Uncommon' },
          { id: 'seed-poc-4', cardId: 'base1-4', rarity: 'Rare Holo' },
        ],
      },
    },
  });

  await prisma.deck.create({
    data: {
      id: 'seed-deck-1',
      userId: 'seed-ash',
      name: 'Fire Starter',
      format: 'unlimited',
      isPublic: true,
      cards: {
        create: [
          { id: 'seed-dc-1', cardId: 'base1-4', count: 2 },
          { id: 'seed-dc-2', cardId: 'base1-46', count: 4 },
          { id: 'seed-dc-3', cardId: 'base1-58', count: 3 },
        ],
      },
    },
  });

  // Trades before their counter-offers, since counteredTradeId references one.
  for (const trade of TRADES) {
    await prisma.trade.create({
      data: {
        id: trade.id,
        initiatorId: trade.initiatorId,
        recipientId: trade.recipientId,
        status: trade.status,
        currencyFromInitiator: trade.currencyFromInitiator,
        currencyFromRecipient: trade.currencyFromRecipient,
        resolvedAt: trade.resolvedAt,
        counteredTradeId: trade.counteredTradeId,
        items: {
          create: trade.items.map((item) => ({
            id: item.id,
            side: item.side,
            cardId: item.cardId,
            quantity: item.quantity,
          })),
        },
      },
    });
  }

  await prisma.notification.createMany({
    data: [
      {
        id: 'seed-notif-1',
        userId: 'seed-misty',
        type: 'trade.proposed',
        payload: { tradeId: 'seed-trade-pending' },
        readAt: null,
      },
      {
        id: 'seed-notif-2',
        userId: 'seed-ash',
        type: 'trade.declined',
        payload: { tradeId: 'seed-trade-declined' },
        readAt: new Date('2026-09-11T10:00:00Z'),
      },
    ],
  });
}

await seed();

// Report what landed, and prove the one invariant the schema cannot hold: the
// denormalised balance has to equal the ledger.
const users = await prisma.user.findMany({
  where: { id: { startsWith: 'seed-' } },
  include: { currencyTransactions: true },
  orderBy: { email: 'asc' },
});

for (const user of users) {
  const ledger = user.currencyTransactions.reduce((total, entry) => total + entry.amount, 0);
  const agrees = ledger === user.currency ? 'ok' : 'MISMATCH';
  console.log(
    `  ${user.email.padEnd(24)} balance ${String(user.currency).padStart(6)}  ledger ${String(ledger).padStart(6)}  ${agrees}`,
  );
}

const mismatched = users.filter(
  (user) =>
    user.currencyTransactions.reduce((total, entry) => total + entry.amount, 0) !== user.currency,
);

if (mismatched.length > 0) {
  throw new Error(
    `${mismatched.length} seeded user(s) have a balance that disagrees with their ledger`,
  );
}

console.log(
  `\n  sets ${await prisma.cardSet.count()} · cards ${await prisma.card.count()} · users ${await prisma.user.count()} · trades ${await prisma.trade.count()} · inventory ${await prisma.inventoryItem.count()}`,
);

await prisma.$disconnect();
