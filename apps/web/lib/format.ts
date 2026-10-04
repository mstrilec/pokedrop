const fullCoins = new Intl.NumberFormat('en-US');
const compactCoins = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** `1,250`; from 100 000 abbreviated, `125K`, `1.3M`. */
export function formatCoins(amount: number): string {
  return Math.abs(amount) >= 100_000 ? compactCoins.format(amount) : fullCoins.format(amount);
}

const relative = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });
const absolute = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.35],
  ['month', 12],
  ['year', Number.POSITIVE_INFINITY],
];

/** `12 minutes ago`, `yesterday`, `3 days ago`; under a minute is `just now`. */
export function timeAgo(date: Date, now: Date = new Date()): string {
  let value = (date.getTime() - now.getTime()) / 1000;
  if (Math.abs(value) < 60) return 'just now';
  for (const [unit, size] of STEPS) {
    if (Math.abs(value) < size) return relative.format(Math.round(value), unit);
    value /= size;
  }
  return relative.format(Math.round(value), 'year');
}

export function dateTime(date: Date): string {
  return absolute.format(date);
}
