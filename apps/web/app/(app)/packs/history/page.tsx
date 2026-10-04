import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { PackHistory } from '@/components/packs/pack-history';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Pack history' };

export default function PackHistoryPage() {
  return (
    <>
      <PageHeader
        title="Pack history"
        description="Every pack you have opened, newest first, and what came out of it."
        actions={
          <Button asChild variant="secondary">
            <Link href="/packs">Open a pack</Link>
          </Button>
        }
      />
      <PackHistory />
    </>
  );
}
