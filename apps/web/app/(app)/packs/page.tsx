import type { Metadata } from 'next';
import Link from 'next/link';
import { PacksGrid } from '@/components/packs/packs-grid';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Open packs' };

export default function PacksPage() {
  return (
    <>
      <PageHeader
        title="Open packs"
        description="Every pack lists its odds before you open it."
        actions={
          <Button asChild variant="secondary">
            <Link href="/packs/history">Pack history</Link>
          </Button>
        }
      />
      <PacksGrid />
    </>
  );
}
