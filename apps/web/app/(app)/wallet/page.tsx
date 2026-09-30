import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/page-placeholder';

export const metadata: Metadata = { title: 'Wallet' };

export default function Page() {
  return <PagePlaceholder title="Wallet" ticket="PD-119" />;
}
