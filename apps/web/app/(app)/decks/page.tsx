import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/page-placeholder';

export const metadata: Metadata = { title: 'Decks' };

export default function Page() {
  return <PagePlaceholder title="Decks" ticket="PD-111" />;
}
