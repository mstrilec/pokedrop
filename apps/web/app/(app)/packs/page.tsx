import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/page-placeholder';

export const metadata: Metadata = { title: 'Packs' };

export default function Page() {
  return <PagePlaceholder title="Packs" ticket="PD-104" />;
}
