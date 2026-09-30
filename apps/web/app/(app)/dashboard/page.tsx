import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/page-placeholder';

export const metadata: Metadata = { title: 'Dashboard' };

export default function Page() {
  return <PagePlaceholder title="Dashboard" ticket="PD-103" />;
}
