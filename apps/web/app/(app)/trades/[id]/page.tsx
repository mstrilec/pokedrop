import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { TradeDetailPage } from '@/components/trades/trade-detail';
import { ApiError } from '@/lib/api/core';
import { trade } from '@/lib/api/endpoints/trades';
import { serverApi } from '@/lib/api/server';

// The API answers a trade to its two parties only, so anyone else gets the same 404 as an id
// that never existed. One request for the page and its title.
const loadTrade = cache(async (id: string) => {
  try {
    return { trade: await serverApi.call(trade(id)), at: Date.now() };
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) return null;
    throw error;
  }
});

export async function generateMetadata({ params }: PageProps<'/trades/[id]'>): Promise<Metadata> {
  const { id } = await params;
  const found = await loadTrade(id).catch(() => null);
  if (!found) return { title: 'Trade' };
  const { role, initiator, recipient } = found.trade;
  return { title: `Trade with ${(role === 'recipient' ? initiator : recipient).displayName}` };
}

export default async function Page({ params }: PageProps<'/trades/[id]'>) {
  const { id } = await params;
  const found = await loadTrade(id);
  if (!found) notFound();
  return <TradeDetailPage id={id} initial={found.trade} initialAt={found.at} />;
}
