import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/page-placeholder';

export const metadata: Metadata = { title: 'Forgot password' };

export default function Page() {
  return <PagePlaceholder title="Forgot password" ticket="PD-102" />;
}
