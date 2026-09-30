import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/page-placeholder';

export const metadata: Metadata = { title: 'Propose a trade' };

export default function Page() {
  return <PagePlaceholder title="Propose a trade" ticket="PD-115" />;
}
