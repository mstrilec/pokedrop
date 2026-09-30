import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/page-placeholder';

export const metadata: Metadata = { title: 'Open a pack' };

export default function Page() {
  return <PagePlaceholder title="Open a pack" ticket="PD-105" />;
}
