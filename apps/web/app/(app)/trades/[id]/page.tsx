import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/page-placeholder';

export const metadata: Metadata = { title: 'Trade' };

export default function Page() {
  return <PagePlaceholder title="Trade" ticket="PD-116" />;
}
