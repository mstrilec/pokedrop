import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/page-placeholder';

export const metadata: Metadata = { title: 'Users' };

export default function Page() {
  return <PagePlaceholder title="Users" ticket="PD-122" />;
}
