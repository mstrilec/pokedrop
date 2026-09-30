import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/page-placeholder';

export const metadata: Metadata = { title: 'Audit log' };

export default function Page() {
  return <PagePlaceholder title="Audit log" ticket="PD-123" />;
}
