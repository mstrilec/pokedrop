import type { Metadata } from 'next';
import { TradesInbox } from '@/components/trades/trades-inbox';

export const metadata: Metadata = { title: 'Trades' };

export default function TradesPage() {
  return <TradesInbox />;
}
