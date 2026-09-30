import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/page-placeholder';

export const metadata: Metadata = { title: 'Deck' };

export default function Page() {
  return <PagePlaceholder title="Deck" ticket="PD-112" />;
}
