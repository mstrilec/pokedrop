import type { NotificationView } from '@pokedrop/shared';
import {
  ArrowLeftRight,
  Ban,
  Bell,
  CheckCheck,
  Clock,
  Coins,
  type LucideIcon,
  Repeat,
  ShieldAlert,
  X,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { dateTime, formatCoins, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

type Kind = {
  icon: LucideIcon;
  tint: string;
  text: (who: ReactNode, n: NotificationView) => ReactNode;
};

const TRADE_KINDS: Record<string, Kind> = {
  'trade.proposed': {
    icon: ArrowLeftRight,
    tint: 'bg-gold-dim text-gold',
    text: (who) => <>{who} proposed a trade</>,
  },
  'trade.accepted': {
    icon: CheckCheck,
    tint: 'bg-grn/14 text-grn',
    text: (who) => <>{who} accepted your trade</>,
  },
  'trade.declined': {
    icon: X,
    tint: 'bg-red-dim text-red',
    text: (who) => <>{who} declined your trade</>,
  },
  'trade.cancelled': {
    icon: Ban,
    tint: 'bg-surface-2 text-mut',
    text: (who) => <>{who} cancelled their trade</>,
  },
  'trade.countered': {
    icon: Repeat,
    tint: 'bg-rarity-ultra-tint text-rarity-ultra',
    text: (who) => <>{who} countered your offer</>,
  },
  'trade.voided': {
    icon: ShieldAlert,
    tint: 'bg-red-dim text-red',
    text: (who) => <>An admin voided your trade with {who}</>,
  },
  'trade.expired': {
    icon: Clock,
    tint: 'bg-surface-2 text-mut',
    text: (who) => <>Your trade with {who} expired</>,
  },
};

const GRANT: Kind = {
  icon: Coins,
  tint: 'bg-gold-dim text-gold',
  text: (_, n) => {
    const amount = typeof n.payload.amount === 'number' ? n.payload.amount : 0;
    return amount >= 0 ? (
      <>
        <b className="font-semibold">+{formatCoins(amount)} coins</b> were added to your balance
      </>
    ) : (
      <>
        <b className="font-semibold">−{formatCoins(-amount)} coins</b> were taken from your balance
        by an admin
      </>
    );
  },
};

const UNKNOWN: Kind = {
  icon: Bell,
  tint: 'bg-pri-dim text-pri',
  text: () => 'You have a new notification',
};

function kindOf(type: string): Kind {
  if (type === 'currency.granted') return GRANT;
  return TRADE_KINDS[type] ?? UNKNOWN;
}

/** Where a notification leads: its trade, or the wallet for coins. */
export function notificationHref(n: NotificationView): string {
  if (n.type.startsWith('trade.') && typeof n.payload.tradeId === 'string') {
    return `/trades/${n.payload.tradeId}`;
  }
  return n.type === 'currency.granted' ? '/wallet' : '/notifications';
}

export function NotificationRow({
  notification,
  href = notificationHref(notification),
  onActivate,
  now,
  className,
}: {
  notification: NotificationView;
  href?: string;
  /** Called on activation, before navigating: mark it read here. */
  onActivate?: () => void;
  /** Fixed in demos; defaults to the moment of render. */
  now?: Date;
  className?: string;
}) {
  const kind = kindOf(notification.type);
  const Icon = kind.icon;
  const unread = notification.readAt === null;
  const who = (
    <b className="font-semibold">{notification.counterparty?.displayName ?? 'Someone'}</b>
  );

  return (
    <Link
      href={href}
      onClick={onActivate}
      className={cn(
        'focus-ring flex items-start gap-3.5 rounded-tile border px-4 py-3.5 transition hover:border-bd-2',
        unread ? 'border-pri/20 bg-pri/5' : 'border-bd bg-surface',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-9.5 shrink-0 items-center justify-center rounded-control',
          kind.tint,
        )}
      >
        <Icon className="size-4.25" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-body text-tx">
          {unread ? <span className="sr-only">Unread: </span> : null}
          {kind.text(who, notification)}
        </span>{' '}
        <time
          dateTime={notification.createdAt.toISOString()}
          title={dateTime(notification.createdAt)}
          className="text-caption tracking-normal text-faint"
        >
          {timeAgo(notification.createdAt, now)}
        </time>
      </span>
      {unread ? (
        <span aria-hidden className="mt-1.5 size-2.25 shrink-0 rounded-pill bg-pri" />
      ) : null}
    </Link>
  );
}
