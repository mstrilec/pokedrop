import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/page-placeholder';

export const metadata: Metadata = { title: 'Notifications' };

export default function Page() {
  return <PagePlaceholder title="Notifications" ticket="PD-120" />;
}
