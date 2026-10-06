import type { TradeView } from '@pokedrop/shared';
import { useSyncExternalStore } from 'react';
import { formatCoins } from '@/lib/format';

// The countdown moves once a minute; one clock for every reader.
const MINUTE = 60_000;
function subscribeToMinutes(notify: () => void) {
  const timer = setInterval(notify, MINUTE);
  return () => clearInterval(timer);
}
export function useMinute(): number {
  return useSyncExternalStore(
    subscribeToMinutes,
    () => Math.floor(Date.now() / MINUTE) * MINUTE,
    () => 0,
  );
}

export function expiryText(expiresAt: Date, now: number): string {
  const left = expiresAt.getTime() - now;
  // The expiry job runs hourly, so a due trade closes within the hour after.
  if (left <= 0) return 'Expiring now';
  const minutes = Math.ceil(left / MINUTE);
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const mins = minutes % 60;
  if (days > 0) return `Expires in ${days}d ${hours}h`;
  if (hours > 0) return `Expires in ${hours}h ${mins}m`;
  return `Expires in ${mins}m`;
}

/** One side of a trade in words: up to two card names, a count of the rest, and coins. */
function sideText(trade: TradeView, side: 'OFFERED' | 'REQUESTED', coins: number): string {
  const lines = trade.items.filter((item) => item.side === side);
  const named = lines
    .slice(0, 2)
    .map((item) => (item.quantity > 1 ? `${item.card.name} ×${item.quantity}` : item.card.name));
  const rest = lines.slice(2).reduce((sum, item) => sum + item.quantity, 0);
  const parts = [...named];
  if (rest > 0) parts.push(`${rest} more ${rest === 1 ? 'card' : 'cards'}`);
  if (coins > 0) parts.push(`${formatCoins(coins)} ${coins === 1 ? 'coin' : 'coins'}`);
  return parts.length > 0 ? parts.join(', ') : 'Nothing';
}

export function sides(trade: TradeView) {
  const offered = sideText(trade, 'OFFERED', trade.currencyFromInitiator);
  const requested = sideText(trade, 'REQUESTED', trade.currencyFromRecipient);
  return trade.role === 'recipient'
    ? { give: requested, get: offered }
    : { give: offered, get: requested };
}
