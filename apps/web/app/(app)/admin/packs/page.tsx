import type { Metadata } from 'next';
import { AdminPacks } from '@/components/admin/packs/admin-packs';

export const metadata: Metadata = { title: 'Pack templates' };

export default function Page() {
  return <AdminPacks />;
}
