import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/page-placeholder';

export const metadata: Metadata = { title: 'Reset password' };

export default function Page() {
  return <PagePlaceholder title="Reset password" ticket="PD-102" />;
}
