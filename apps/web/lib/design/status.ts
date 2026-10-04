import type { TradeStatus } from '@pokedrop/shared';
import type { BadgeTone } from '@/components/ui/badge';

export interface StatusStyle {
  label: string;
  tone: BadgeTone;
}

export const TRADE_STATUS_STYLES: Record<TradeStatus, StatusStyle> = {
  PENDING: { label: 'Pending', tone: 'warning' },
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  COUNTERED: { label: 'Countered', tone: 'accent' },
  DECLINED: { label: 'Declined', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  VOIDED: { label: 'Voided', tone: 'danger' },
};
