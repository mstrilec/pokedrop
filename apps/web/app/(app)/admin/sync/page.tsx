import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/page-placeholder';

export const metadata: Metadata = { title: 'Sync control' };

export default function Page() {
  return <PagePlaceholder title="Sync control" ticket="PD-122" />;
}
