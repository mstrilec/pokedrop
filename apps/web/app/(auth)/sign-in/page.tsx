import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/page-placeholder';

export const metadata: Metadata = { title: 'Sign in' };

export default function Page() {
  return <PagePlaceholder title="Sign in" ticket="PD-102" />;
}
