import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PackRevealScreen } from '@/components/packs/reveal/pack-reveal';
import { parseOpenParams } from '@/lib/pack-open-flow';

export const metadata: Metadata = { title: 'Open a pack' };

export default async function PackOpenPage({ searchParams }: PageProps<'/packs/open'>) {
  const params = parseOpenParams(await searchParams);
  if (!params) redirect('/packs');

  return (
    <div className="flex min-h-[calc(100dvh-10rem)] items-center justify-center overflow-clip">
      <PackRevealScreen key={params.openId} templateId={params.templateId} openId={params.openId} />
    </div>
  );
}
