import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/page-placeholder';

export const metadata: Metadata = { title: 'Trade moderation' };

export default function Page() {
  return <PagePlaceholder title="Trade moderation" ticket="PD-123" />;
}
