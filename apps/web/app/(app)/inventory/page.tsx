import type { Metadata } from 'next';
import { InventoryHeader } from '@/components/inventory/inventory-header';
import { InventoryView } from '@/components/inventory/inventory-view';

export const metadata: Metadata = { title: 'Your collection' };

export default function InventoryPage() {
  return (
    <>
      <InventoryHeader />
      <InventoryView />
    </>
  );
}
