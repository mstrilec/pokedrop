import type { Metadata } from 'next';
import { TradeComposerPage } from '@/components/trades/composer/trade-composer';

export const metadata: Metadata = { title: 'Propose a trade' };

const one = (value: string | string[] | undefined) =>
  typeof value === 'string' && value ? value : undefined;

export default async function NewTradePage({ searchParams }: PageProps<'/trades/new'>) {
  const params = await searchParams;
  const to = one(params.to);
  const card = one(params.card);
  const counter = one(params.counter);
  // Keyed by the parameters: a link to a different pre-fill starts a fresh composer.
  return (
    <TradeComposerPage
      key={`${to ?? ''}|${card ?? ''}|${counter ?? ''}`}
      to={to}
      card={card}
      counter={counter}
    />
  );
}
