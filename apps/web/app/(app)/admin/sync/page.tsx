import type { Metadata } from 'next';
import { SyncControl } from '@/components/admin/sync/sync-control';

export const metadata: Metadata = { title: 'Sync control' };

export default function Page() {
  return <SyncControl />;
}
