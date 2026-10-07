import type { AuditEntry } from '@pokedrop/shared';
import { formatCoins } from '@/lib/format';

const ACTIONS: Record<string, string> = {
  'trade.propose': 'Proposed a trade',
  'trade.counter': 'Countered a trade',
  'trade.accept': 'Accepted a trade',
  'trade.decline': 'Declined a trade',
  'trade.cancel': 'Cancelled a trade',
  'trade.expire': 'Expired a trade',
  'trade.void': 'Voided a trade',
  'user.currency_grant': 'Adjusted coins',
  'user.role_change': 'Changed a role',
  'user.suspend': 'Suspended an account',
  'user.unsuspend': 'Unsuspended an account',
  'pack_template.create': 'Created a pack template',
  'pack_template.update': 'Changed a pack template',
  'sync.trigger': 'Started a sync',
  'sync.breaker_reset': 'Reset a provider breaker',
};

export const KNOWN_ACTIONS = Object.keys(ACTIONS);

export function actionWords(action: string): string {
  return ACTIONS[action] ?? action;
}

const str = (value: unknown) => (typeof value === 'string' ? value : null);
const num = (value: unknown) => (typeof value === 'number' ? value : null);

/** One line from `meta` for the actions whose shape is known; the raw JSON is under *Details*. */
export function metaSummary(entry: AuditEntry): string | null {
  const m = entry.meta;
  const reason = str(m.reason);
  switch (entry.action) {
    case 'user.currency_grant': {
      const amount = num(m.amount);
      return amount === null
        ? null
        : `${amount > 0 ? '+' : '−'}${formatCoins(Math.abs(amount))} coins${reason ? ` — ${reason}` : ''}`;
    }
    case 'user.role_change':
      return `${str(m.from) ?? '?'} → ${str(m.to) ?? '?'}`;
    case 'user.suspend': {
      const voided = Array.isArray(m.voidedTradeIds) ? m.voidedTradeIds.length : 0;
      return (
        `${reason ?? ''}${voided > 0 ? ` · ${voided} pending ${voided === 1 ? 'trade' : 'trades'} voided` : ''}` ||
        null
      );
    }
    case 'pack_template.update': {
      const changes = m.changes;
      return changes && typeof changes === 'object'
        ? `Changed ${Object.keys(changes).join(', ')}`
        : null;
    }
    case 'sync.trigger':
      return str(m.kind) ? `${str(m.kind)?.toLowerCase()} sync` : null;
    case 'sync.breaker_reset':
      return num(m.failures) !== null ? `${num(m.failures)} failures cleared` : null;
    default:
      if (entry.entity === 'Trade') {
        const to = str(m.to);
        return (
          [to ? `${str(m.from) ?? 'new'} → ${to}` : null, reason ? `reason: ${reason}` : null]
            .filter(Boolean)
            .join(' · ') || null
        );
      }
      return reason;
  }
}

export function entityHref(entry: AuditEntry): string {
  switch (entry.entity) {
    case 'Trade':
      return `/admin/trades/${encodeURIComponent(entry.entityId)}`;
    case 'User':
      return `/admin/users?q=${encodeURIComponent(entry.subject?.email ?? entry.entityId)}`;
    case 'PackTemplate':
      return `/admin/packs?template=${encodeURIComponent(entry.entityId)}`;
    default:
      return '/admin/sync';
  }
}

export function entityLabel(entry: AuditEntry): string {
  if (entry.subject) return entry.subject.label;
  if (entry.entity === 'Trade') return `Trade ${entry.entityId.slice(0, 8)}…`;
  if (entry.entity === 'SyncJob') return `Sync job ${entry.entityId.slice(0, 8)}`;
  return `${entry.entity} ${entry.entityId}`;
}
