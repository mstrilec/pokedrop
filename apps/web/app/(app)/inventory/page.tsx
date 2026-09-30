import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/page-placeholder';

export const metadata: Metadata = { title: 'Inventory' };

export default function Page() {
  return <PagePlaceholder title="Inventory" ticket="PD-107" />;
}
