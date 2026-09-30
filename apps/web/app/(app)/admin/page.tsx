import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/page-placeholder';

export const metadata: Metadata = { title: 'Admin overview' };

export default function Page() {
  return <PagePlaceholder title="Admin overview" ticket="PD-121" />;
}
