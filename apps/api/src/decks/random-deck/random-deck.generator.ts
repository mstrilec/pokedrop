import {
  BASIC_ENERGY_TYPES,
  basicEnergyTypeOf,
  copyLimitKey,
  DECK_MAX_COPIES,
  type BasicEnergyType,
} from '@pokedrop/shared';
import type { Rng } from '../../packs/pack-rng.js';
import { generatableTypes, isBasicEnergy } from './random-deck.pool.js';
import type { GenerateOptions, GenerateResult, PoolCard, Shortfall } from './random-deck.types.js';

const POKEMON_TARGET = [16, 18] as const;
const POKEMON_MIN = 12;
const MAX_LINES = 4;
const MAX_STAGES = 3;
const MAX_LINE_COPIES = 4 + 3 + 3;
const POKEMON_ATTEMPTS = 5;
const TRAINER_TARGET = [12, 14] as const;
const TRAINER_FILL_MAX = 15;
const TRAINER_MIN = 8;
const SUPPORTERS = [4, 6] as const;
const STADIUM_MAX = 2;

/** Subtypes allowed once in the whole deck. */
const DECK_SINGLETONS = ['Radiant', 'Star', 'ACE SPEC'] as const;
/** A subtype allowed once per name. */
const NAME_SINGLETON = 'Prism Star';

const SHORTFALL_RANK: Record<Shortfall['code'], number> = {
  NOT_ENOUGH_POKEMON: 0,
  NOT_ENOUGH_TRAINERS: 1,
  NOT_ENOUGH_ENERGY: 2,
};

type Stage = { printings: PoolCard[] };
type Added = { card: PoolCard; n: number };

const isPokemon = (card: PoolCard) => card.supertype === 'Pokémon';
const isTrainer = (card: PoolCard) => card.supertype === 'Trainer';
const isSupporter = (card: PoolCard) => isTrainer(card) && card.subtypes.includes('Supporter');
const isStadium = (card: PoolCard) => isTrainer(card) && card.subtypes.includes('Stadium');
const any = () => true;

/** A deck under construction: counts by card id, and copies used by copy-limit key. */
class Draft {
  readonly counts = new Map<string, number>();
  private readonly byName = new Map<string, number>();
  private readonly singletons = new Map<string, number>();
  private readonly log: Added[] = [];

  constructor(private readonly pool: Map<string, PoolCard>) {}

  room(card: PoolCard): number {
    const left = card.available - (this.counts.get(card.id) ?? 0);
    const key = copyLimitKey(card);
    if (key === null) return Math.max(left, 0);
    const max = card.subtypes.includes(NAME_SINGLETON) ? 1 : DECK_MAX_COPIES;
    let room = Math.min(left, max - (this.byName.get(key) ?? 0));
    for (const kind of DECK_SINGLETONS) {
      if (card.subtypes.includes(kind)) room = Math.min(room, 1 - (this.singletons.get(kind) ?? 0));
    }
    return Math.max(room, 0);
  }

  add(card: PoolCard, n: number): void {
    this.change(card, n);
    this.log.push({ card, n });
  }

  /** Copies of the card's name already in the deck, across printings. */
  used(card: PoolCard): number {
    const key = copyLimitKey(card);
    return key === null ? 0 : (this.byName.get(key) ?? 0);
  }

  mark(): number {
    return this.log.length;
  }

  since(mark: number): Added[] {
    return this.log.slice(mark);
  }

  rollback(mark: number): void {
    while (this.log.length > mark) {
      const { card, n } = this.log.pop()!;
      this.change(card, -n);
    }
  }

  total(predicate: (card: PoolCard) => boolean): number {
    let sum = 0;
    for (const [id, n] of this.counts) {
      if (predicate(this.pool.get(id)!)) sum += n;
    }
    return sum;
  }

  private change(card: PoolCard, n: number): void {
    bump(this.counts, card.id, n);
    const key = copyLimitKey(card);
    if (key === null) return;
    bump(this.byName, key, n);
    for (const kind of DECK_SINGLETONS) {
      if (card.subtypes.includes(kind)) bump(this.singletons, kind, n);
    }
  }
}

function bump(map: Map<string, number>, key: string, n: number): void {
  const next = (map.get(key) ?? 0) + n;
  if (next === 0) map.delete(key);
  else map.set(key, next);
}

/** The pool split the way the generator reads it, every list in card id order. */
class Catalog {
  readonly byId: Map<string, PoolCard>;
  readonly pokemon: PoolCard[];
  readonly pokemonByName = new Map<string, PoolCard[]>();
  readonly supporters: PoolCard[];
  readonly otherTrainers: PoolCard[];
  private readonly energy = new Map<BasicEnergyType, PoolCard[]>();

  constructor(pool: PoolCard[]) {
    // The pool's SQL has no order; a seed only reproduces a deck over a sorted pool.
    const sorted = [...pool].sort((a, b) => compare(a.id, b.id));
    this.byId = new Map(sorted.map((card) => [card.id, card]));
    this.pokemon = sorted.filter(isPokemon);
    for (const card of this.pokemon) {
      this.pokemonByName.set(card.name, [...(this.pokemonByName.get(card.name) ?? []), card]);
    }
    this.supporters = sorted.filter(isSupporter);
    this.otherTrainers = sorted.filter((card) => isTrainer(card) && !isSupporter(card));
    for (const card of sorted.filter(isBasicEnergy)) {
      const type = basicEnergyTypeOf(card.name);
      if (type !== null) this.energy.set(type, [...(this.energy.get(type) ?? []), card]);
    }
  }

  energyOf(type: BasicEnergyType): PoolCard[] {
    return this.energy.get(type) ?? [];
  }
}

export function generateDeck(pool: PoolCard[], options: GenerateOptions, rng: Rng): GenerateResult {
  const catalog = new Catalog(pool);
  let best: { shortfall: Shortfall; score: number } | null = null;
  for (const types of candidateTypeSets(pool, options.types, rng)) {
    const built = build(catalog, types, options.deckSize, rng);
    if (built.result === 'deck') return built;
    const score = informative(built, types.length);
    if (best === null || score > best.score) best = { shortfall: built, score };
  }
  return best?.shortfall ?? pokemonShortfall([...options.types], 0);
}

/**
 * The requested types, or for Surprise me each generatable type in random order, at even odds
 * first paired with another; the single type follows its pair so every type is tried alone.
 * A pool without basic Energy tries the types of its Pokémon, so the shortfall names one.
 */
function candidateTypeSets(
  pool: PoolCard[],
  requested: BasicEnergyType[],
  rng: Rng,
): BasicEnergyType[][] {
  if (requested.length > 0) return [requested];
  const generatable = generatableTypes(pool);
  const ofPokemon = BASIC_ENERGY_TYPES.filter((type) =>
    pool.some((card) => isPokemon(card) && card.types[0] === type),
  );
  const order = shuffle(
    generatable.length > 0
      ? generatable
      : ofPokemon.length > 0
        ? ofPokemon
        : [...BASIC_ENERGY_TYPES],
    rng,
  );
  const sets: BasicEnergyType[][] = [];
  for (const type of order) {
    if (order.length > 1 && rng.int(2) === 1) {
      const others = order.filter((other) => other !== type);
      sets.push([type, others[rng.int(others.length)]!]);
    }
    sets.push([type]);
  }
  return sets;
}

/** The furthest stage reached, then the closest to its minimum, then a single type. */
function informative(shortfall: Shortfall, typeCount: number): number {
  return (
    SHORTFALL_RANK[shortfall.code] * 4 +
    Math.min(shortfall.have / shortfall.need, 1) * 2 +
    (typeCount === 1 ? 1 : 0)
  );
}

function build(
  catalog: Catalog,
  types: BasicEnergyType[],
  deckSize: number,
  rng: Rng,
): GenerateResult {
  const draft = new Draft(catalog.byId);

  const pokemon = buildPokemon(catalog, draft, types, rng);
  if (pokemon < POKEMON_MIN) return pokemonShortfall(types, pokemon);

  const trainerTarget = between(TRAINER_TARGET, rng);
  const supporterTarget = between(SUPPORTERS, rng);
  addTrainers(catalog.supporters, draft, rng, [
    [isSupporter, supporterTarget],
    [isTrainer, trainerTarget],
  ]);
  addTrainers(catalog.otherTrainers, draft, rng, [[isTrainer, trainerTarget]]);
  const trainers = draft.total(isTrainer);
  if (trainers < TRAINER_MIN) {
    return {
      result: 'shortfall',
      code: 'NOT_ENOUGH_TRAINERS',
      type: null,
      have: trainers,
      need: TRAINER_MIN,
      message: `You own ${trainers} Trainers; a deck needs at least ${TRAINER_MIN}`,
    };
  }

  const energyRoom = types.reduce(
    (sum, type) => sum + catalog.energyOf(type).reduce((n, card) => n + draft.room(card), 0),
    0,
  );
  if (deckSize - draft.total(any) > energyRoom) {
    addTrainers(catalog.otherTrainers, draft, rng, [[isTrainer, TRAINER_FILL_MAX]]);
    addTrainers(catalog.supporters, draft, rng, [
      [isSupporter, SUPPORTERS[1]],
      [isTrainer, TRAINER_FILL_MAX],
    ]);
  }

  const short = addEnergy(catalog, draft, types, deckSize - draft.total(any), rng);
  if (short !== null) return short;

  const cards = [...draft.counts]
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => compare(a, b))
    .map(([cardId, count]) => ({ cardId, count }));
  return { result: 'deck', types, cards };
}

function pokemonShortfall(types: BasicEnergyType[], have: number): Shortfall {
  return {
    result: 'shortfall',
    code: 'NOT_ENOUGH_POKEMON',
    type: types[0] ?? null,
    have,
    need: POKEMON_MIN,
    message: `You own ${have} ${types.join(' or ')} Pokémon; a deck needs at least ${POKEMON_MIN}`,
  };
}

/**
 * Whole lines until the Pokémon count reaches a target drawn in 16–18, never past 18, at most
 * four lines. A draw that ends under 16 is redrawn; the best of the draws is kept.
 */
function buildPokemon(catalog: Catalog, draft: Draft, types: BasicEnergyType[], rng: Rng): number {
  const target = between(POKEMON_TARGET, rng);
  const ofTypes = (card: PoolCard) => types.some((type) => type === card.types[0]);
  const tops = catalog.pokemon.filter(ofTypes);
  const start = draft.mark();
  let best: { total: number; added: Added[] } = { total: 0, added: [] };
  for (let attempt = 0; attempt < POKEMON_ATTEMPTS; attempt++) {
    const total = drawLines(shuffle(tops, rng), target, catalog, draft, ofTypes, rng);
    if (total >= POKEMON_TARGET[0]) return total;
    if (total > best.total) best = { total, added: draft.since(start) };
    draft.rollback(start);
  }
  for (const { card, n } of best.added) draft.add(card, n);
  return best.total;
}

/**
 * The first pass takes only lines that share no name with the deck and still leave room for
 * the remaining lines to reach 16; the second pass takes any line that fits.
 */
function drawLines(
  tops: PoolCard[],
  target: number,
  catalog: Catalog,
  draft: Draft,
  ofTypes: (card: PoolCard) => boolean,
  rng: Rng,
): number {
  let lines = 0;
  for (const strict of [true, false]) {
    for (const top of tops) {
      const total = draft.total(isPokemon);
      if (total >= target || lines === MAX_LINES) return total;
      const line = resolveLine(top, catalog, draft, ofTypes);
      if (line === null) continue;
      if (strict && line.some((stage) => draft.used(stage.printings[0]!) > 0)) continue;
      for (const shape of shapesFor(line.length, rng)) {
        const mark = draft.mark();
        const placed = placeLine(line, shape, draft, rng);
        const after = total + placed;
        const reachable = after + (MAX_LINES - lines - 1) * MAX_LINE_COPIES >= POKEMON_TARGET[0];
        if (placed > 0 && after <= POKEMON_TARGET[1] && (!strict || reachable)) {
          lines += 1;
          break;
        }
        draft.rollback(mark);
      }
    }
  }
  return draft.total(isPokemon);
}

/**
 * The stages from Basic to the top, each the pool's printings that evolve from the stage below
 * (a Basic: printings with no evolvesFrom and the Basic subtype, so a Stage 1 mirrored without
 * its evolvesFrom never passes for one). Null when a stage is missing
 * from the pool or out of room, when the line loops, or when it is longer than three stages.
 */
function resolveLine(
  top: PoolCard,
  catalog: Catalog,
  draft: Draft,
  ofTypes: (card: PoolCard) => boolean,
): Stage[] | null {
  const evolvesFrom = (from: string | null) => (card: PoolCard) =>
    card.evolvesFrom === from && (from !== null || card.subtypes.includes('Basic'));
  const hasRoom = (card: PoolCard) => draft.room(card) > 0;

  const seen = new Set<string>([top.name]);
  let from = top.evolvesFrom;
  let printings = (catalog.pokemonByName.get(top.name) ?? []).filter(
    (card) => ofTypes(card) && evolvesFrom(from)(card) && hasRoom(card),
  );
  const stages: Stage[] = [];
  for (;;) {
    if (printings.length === 0) return null;
    stages.unshift({ printings });
    if (from === null) return stages.length <= MAX_STAGES ? stages : null;
    if (seen.has(from)) return null;
    seen.add(from);
    const lower = (catalog.pokemonByName.get(from) ?? []).filter(hasRoom);
    const next = lower.find(evolvesFrom(null)) ?? lower.find((card) => card.evolvesFrom !== null);
    if (next === undefined) return null;
    from = next.evolvesFrom;
    printings = lower.filter(evolvesFrom(from));
  }
}

/** The line's shape, then the shorter one when the first is the longer of two. */
function shapesFor(stages: number, rng: Rng): number[][] {
  if (stages === 3) {
    return rng.int(2) === 1
      ? [
          [4, 3, 3],
          [3, 2, 2],
        ]
      : [[3, 2, 2]];
  }
  if (stages === 2) return [[3, 2]];
  return rng.int(2) === 1 ? [[3], [2]] : [[2]];
}

/** Copies placed, or 0 when a stage could not get one (the caller rolls the line back). */
function placeLine(line: Stage[], shape: number[], draft: Draft, rng: Rng): number {
  let placed = 0;
  for (const [i, stage] of line.entries()) {
    let want = shape[i]!;
    let got = 0;
    while (want > 0) {
      const open = stage.printings.filter((card) => draft.room(card) > 0);
      if (open.length === 0) break;
      const card = open[rng.int(open.length)]!;
      const n = Math.min(want, draft.room(card));
      draft.add(card, n);
      want -= n;
      got += n;
    }
    if (got === 0) return 0;
    placed += got;
  }
  return placed;
}

/** 1–4 copies of each printing in random order, within room and every cap's remaining copies. */
function addTrainers(
  printings: PoolCard[],
  draft: Draft,
  rng: Rng,
  caps: [(card: PoolCard) => boolean, number][],
): void {
  const [overall] = caps;
  for (const card of shuffle(printings, rng)) {
    if (overall !== undefined && draft.total(overall[0]) >= overall[1]) return;
    let n = Math.min(1 + rng.int(DECK_MAX_COPIES), draft.room(card));
    for (const [predicate, max] of caps) {
      if (predicate(card)) n = Math.min(n, max - draft.total(predicate));
    }
    if (isStadium(card)) n = Math.min(n, STADIUM_MAX - draft.total(isStadium));
    if (n > 0) draft.add(card, n);
  }
}

/** The rest of the deck split across the types, an odd copy to the first. */
function addEnergy(
  catalog: Catalog,
  draft: Draft,
  types: BasicEnergyType[],
  need: number,
  rng: Rng,
): Shortfall | null {
  for (const [i, type] of types.entries()) {
    const share = i === 0 ? Math.ceil(need / types.length) : Math.floor(need / types.length);
    const printings = shuffle(catalog.energyOf(type), rng);
    const have = printings.reduce((sum, card) => sum + draft.room(card), 0);
    if (have < share) {
      return {
        result: 'shortfall',
        code: 'NOT_ENOUGH_ENERGY',
        type,
        have,
        need: share,
        message: `You own ${have} basic ${type} Energy; this deck needs ${share}`,
      };
    }
    let left = share;
    for (const card of printings) {
      if (left === 0) break;
      const n = Math.min(left, draft.room(card));
      if (n > 0) draft.add(card, n);
      left -= n;
    }
  }
  return null;
}

function between([min, max]: readonly [number, number], rng: Rng): number {
  return min + rng.int(max - min + 1);
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
