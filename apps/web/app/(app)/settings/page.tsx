import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/page-placeholder';

export const metadata: Metadata = { title: 'Account settings' };

export default function Page() {
  return <PagePlaceholder title="Account settings" ticket="PD-118" />;
}
