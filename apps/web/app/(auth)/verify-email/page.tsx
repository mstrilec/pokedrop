import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/page-placeholder';

export const metadata: Metadata = { title: 'Verify email' };

export default function Page() {
  return <PagePlaceholder title="Verify email" ticket="PD-102" />;
}
