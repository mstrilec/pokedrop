/** `YYYY-MM-DD` in UTC — the day every metric in this module is keyed on. */
export function utcDayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}
