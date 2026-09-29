/**
 * Prisma passes `contains` to ILIKE unescaped: measured, `_` matched every
 * row and `pokedrop_test` matched `pokedrop.test`. Backslash is ILIKE's
 * default escape character.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
