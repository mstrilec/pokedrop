import type { Metadata } from 'next';
import { AdminTrades } from '@/components/admin/trades/admin-trades';

export const metadata: Metadata = { title: 'Trade moderation' };

export default function Page() {
  return <AdminTrades />;
}
