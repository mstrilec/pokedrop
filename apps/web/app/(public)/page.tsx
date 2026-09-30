import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/page-placeholder';

export const metadata: Metadata = { title: 'Welcome' };

export default function Page() {
  return <PagePlaceholder title="Welcome" ticket="PD-101" />;
}
