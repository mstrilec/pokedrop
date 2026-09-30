import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/page-placeholder';

export const metadata: Metadata = { title: 'Pack templates' };

export default function Page() {
  return <PagePlaceholder title="Pack templates" ticket="PD-121" />;
}
