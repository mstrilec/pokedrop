import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/page-placeholder';

export const metadata: Metadata = { title: 'Pack history' };

export default function Page() {
  return <PagePlaceholder title="Pack history" ticket="PD-106" />;
}
