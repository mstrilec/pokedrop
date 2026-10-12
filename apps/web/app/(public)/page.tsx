import type { Metadata } from 'next';
import { ChaseMarquee } from '@/components/landing/chase-marquee';
import { DeckPreview } from '@/components/landing/deck-preview';
import { FinalCta } from '@/components/landing/final-cta';
import { Hero } from '@/components/landing/hero';
import { HowItWorks } from '@/components/landing/how-it-works';
import { LandingFaq } from '@/components/landing/landing-faq';
import { landingData } from '@/components/landing/landing-data';
import { PackShowcase } from '@/components/landing/pack-showcase';
import { SetStrip } from '@/components/landing/set-strip';
import { TradeBeats } from '@/components/landing/trade-beats';
import { getOptionalProfile } from '@/lib/session/server';

const DESCRIPTION =
  'Open Pokémon TCG booster packs, complete every set, build legal decks and trade cards safely with other collectors.';

export const metadata: Metadata = {
  title: { absolute: 'PokéDrop · Open, collect, build and trade Pokémon cards' },
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'PokéDrop',
    title: 'PokéDrop · Open, collect, build and trade Pokémon cards',
    description: DESCRIPTION,
    url: '/',
  },
};

export default async function LandingPage() {
  const profile = await getOptionalProfile();
  const signedIn = profile !== null;
  const data = await landingData(signedIn);

  return (
    // The page runs edge to edge: it undoes the padding both shells give their main.
    <div className="-m-8 overflow-x-clip">
      <Hero signedIn={signedIn} cardCount={data.cardCount} sets={data.sets} />
      <HowItWorks />
      <PackShowcase signedIn={signedIn} />
      <ChaseMarquee cards={data.chase} sets={data.sets} />
      <SetStrip sets={data.sets} completion={data.completion} />
      <DeckPreview />
      <TradeBeats />
      <LandingFaq />
      <FinalCta signedIn={signedIn} />
    </div>
  );
}
