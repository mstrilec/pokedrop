import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/page-placeholder';

export const metadata: Metadata = { title: 'Card' };

export default function Page() {
  return <PagePlaceholder title="Card" ticket="PD-110" />;
}
