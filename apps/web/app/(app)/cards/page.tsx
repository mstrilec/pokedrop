import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/page-placeholder';

export const metadata: Metadata = { title: 'Browse cards' };

export default function Page() {
  return <PagePlaceholder title="Browse cards" ticket="PD-108" />;
}
