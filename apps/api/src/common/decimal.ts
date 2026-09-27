/**
 * Prisma returns `Decimal` for price columns and JSON.stringify turns one into a
 * string, which then fails every response schema that promises a number.
 * Decimal(10,2) fits a JS number exactly, so the conversion is lossless.
 */
export function toNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
