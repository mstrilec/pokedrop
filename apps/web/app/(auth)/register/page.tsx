import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/page-placeholder';

export const metadata: Metadata = { title: 'Create account' };

export default function Page() {
  return <PagePlaceholder title="Create account" ticket="PD-102" />;
}
