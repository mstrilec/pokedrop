import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/page-placeholder';

export const metadata: Metadata = { title: 'Profile' };

export default function Page() {
  return <PagePlaceholder title="Profile" ticket="PD-117" />;
}
