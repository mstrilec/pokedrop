import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { AdminTradeDetail } from '@/components/admin/trades/admin-trade-detail';
import { ApiError } from '@/lib/api/core';
import { adminTrade } from '@/lib/api/endpoints/admin';
import { serverApi } from '@/lib/api/server';

const loadTrade = cache(async (id: string) => {
  try {
    return { trade: await serverApi.call(adminTrade(id)), at: Date.now() };
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) return null;
    throw error;
  }
});

export async function generateMetadata({
  params,
}: PageProps<'/admin/trades/[id]'>): Promise<Metadata> {
  const { id } = await params;
  const found = await loadTrade(id).catch(() => null);
  return {
    title: found
      ? `${found.trade.initiator.displayName} → ${found.trade.recipient.displayName}`
      : 'Trade',
  };
}

export default async function Page({ params }: PageProps<'/admin/trades/[id]'>) {
  const { id } = await params;
  const found = await loadTrade(id);
  if (!found) notFound();
  return <AdminTradeDetail id={id} initial={found.trade} initialAt={found.at} />;
}
