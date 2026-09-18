import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TransactionClient } from '../prisma/index.js';
import type { CardDTO, SetDTO } from './providers/index.js';

/**
 * The only raw SQL in this module.
 *
 * It is raw because Prisma has no conditional-update upsert, and the guard is
 * the entire point: `prisma.card.upsert` issues an UPDATE on conflict
 * unconditionally, which rewrites every row of a 20 670-card catalog on every
 * sweep. Measured with `xmin`, which changes whenever PostgreSQL rewrites a
 * tuple - an unguarded upsert of a byte-identical payload moved it, the guarded
 * form did not.
 *
 * Three rules hold this together, and breaking any of them is silent:
 *
 * - Column names are quoted. They are camelCase in the database, so unquoted
 *   PostgreSQL folds them and looks for `setid`.
 * - `"updatedAt"` is set with now(), because Prisma's `@updatedAt` applies in
 *   its query layer and raw SQL bypasses it.
 * - `"updatedAt"` is NOT in the comparison tuple. Including it would make every
 *   row differ from itself, restoring the churn this exists to remove while the
 *   SQL still looks guarded.
 */
@Injectable()
export class CatalogWriter {
  /** jsonb has to be handed over as text with an explicit cast; a bound object does not work. */
  private json(value: unknown): Prisma.Sql {
    return Prisma.sql`${JSON.stringify(value)}::jsonb`;
  }

  async upsertSets(tx: TransactionClient, sets: SetDTO[]): Promise<number> {
    if (sets.length === 0) {
      return 0;
    }

    const values = Prisma.join(
      sets.map(
        (s) => Prisma.sql`(${s.id}, ${s.name}, ${s.series}, ${s.releaseDate},
          ${s.printedTotal}, ${s.total}, ${s.symbolUrl}, ${s.logoUrl}, now())`,
      ),
    );

    return tx.$executeRaw`
      INSERT INTO sets (id, name, series, "releaseDate", "printedTotal", "total",
        "symbolUrl", "logoUrl", "updatedAt")
      VALUES ${values}
      ON CONFLICT (id) DO UPDATE SET
        name = excluded.name,
        series = excluded.series,
        "releaseDate" = excluded."releaseDate",
        "printedTotal" = excluded."printedTotal",
        "total" = excluded."total",
        "symbolUrl" = excluded."symbolUrl",
        "logoUrl" = excluded."logoUrl",
        "updatedAt" = now()
      WHERE (sets.name, sets.series, sets."releaseDate", sets."printedTotal",
             sets."total", sets."symbolUrl", sets."logoUrl")
        IS DISTINCT FROM
            (excluded.name, excluded.series, excluded."releaseDate", excluded."printedTotal",
             excluded."total", excluded."symbolUrl", excluded."logoUrl")
    `;
  }

  async upsertCards(tx: TransactionClient, cards: CardDTO[]): Promise<number> {
    if (cards.length === 0) {
      return 0;
    }

    const values = Prisma.join(
      cards.map(
        (c) => Prisma.sql`(${c.id}, ${c.setId}, ${c.name}, ${c.supertype}, ${c.subtypes},
          ${c.hp}, ${c.types}, ${c.rarity}, ${c.retreatCost},
          ${this.json(c.weaknesses)}, ${this.json(c.resistances)}, ${this.json(c.attacks)},
          ${this.json(c.abilities)}, ${this.json(c.legalities)},
          ${c.nationalPokedexNumbers}, ${c.imageSmall}, ${c.imageLarge},
          ${c.tcgplayerId}, ${c.cardmarketId}, now())`,
      ),
    );

    // latestPriceUsd, latestPriceEur and priceUpdatedAt are absent on purpose.
    // They belong to the price path, and CardDTO has no field for them, so a
    // catalog sync cannot overwrite a fresh price with a stale one.
    return tx.$executeRaw`
      INSERT INTO cards (id, "setId", name, supertype, subtypes, hp, types, rarity,
        "retreatCost", weaknesses, resistances, attacks, abilities, legalities,
        "nationalPokedexNumbers", "imageSmall", "imageLarge", "tcgplayerId",
        "cardmarketId", "updatedAt")
      VALUES ${values}
      ON CONFLICT (id) DO UPDATE SET
        "setId" = excluded."setId",
        name = excluded.name,
        supertype = excluded.supertype,
        subtypes = excluded.subtypes,
        hp = excluded.hp,
        types = excluded.types,
        rarity = excluded.rarity,
        "retreatCost" = excluded."retreatCost",
        weaknesses = excluded.weaknesses,
        resistances = excluded.resistances,
        attacks = excluded.attacks,
        abilities = excluded.abilities,
        legalities = excluded.legalities,
        "nationalPokedexNumbers" = excluded."nationalPokedexNumbers",
        "imageSmall" = excluded."imageSmall",
        "imageLarge" = excluded."imageLarge",
        "tcgplayerId" = excluded."tcgplayerId",
        "cardmarketId" = excluded."cardmarketId",
        "updatedAt" = now()
      WHERE (cards."setId", cards.name, cards.supertype, cards.subtypes, cards.hp,
             cards.types, cards.rarity, cards."retreatCost", cards.weaknesses,
             cards.resistances, cards.attacks, cards.abilities, cards.legalities,
             cards."nationalPokedexNumbers", cards."imageSmall", cards."imageLarge",
             cards."tcgplayerId", cards."cardmarketId")
        IS DISTINCT FROM
            (excluded."setId", excluded.name, excluded.supertype, excluded.subtypes, excluded.hp,
             excluded.types, excluded.rarity, excluded."retreatCost", excluded.weaknesses,
             excluded.resistances, excluded.attacks, excluded.abilities, excluded.legalities,
             excluded."nationalPokedexNumbers", excluded."imageSmall", excluded."imageLarge",
             excluded."tcgplayerId", excluded."cardmarketId")
    `;
  }
}
