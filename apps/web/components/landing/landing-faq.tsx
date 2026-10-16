import { FaqAccordion } from './faq-accordion';
import { Reveal } from './reveal';

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Is it free?',
    a: 'Yes. Every new account gets 1,000 coins to open packs with, and there is nothing to buy.',
  },
  {
    q: 'Is it real money?',
    a: 'No. Coins can’t be bought or cashed out, and cards can’t be sold for money here. Market prices are shown for reference only.',
  },
  {
    q: 'Where do the cards and prices come from?',
    a: 'The catalog is mirrored from pokemontcg.io and TCGdex, with Pokémon data from PokéAPI. Prices come from TCGplayer and Cardmarket, updated nightly.',
  },
  {
    q: 'Can I trade with friends?',
    a: 'Yes, with any member: find them by display name and offer cards and coins. They can accept, decline or counter, and nothing moves until both sides agree.',
  },
  {
    q: 'Is PokéDrop official?',
    a: 'No. It is a fan project, not affiliated with Nintendo, Creatures, GAME FREAK or The Pokémon Company.',
  },
];

const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ.map(({ q, a }) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: { '@type': 'Answer', text: a },
  })),
};

export function LandingFaq() {
  return (
    <section
      aria-labelledby="faq-title"
      className="mx-auto max-w-200 px-5 py-14 sm:py-20 lg:py-28 sm:px-14"
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, '\\u003c') }}
      />
      <Reveal>
        <h2
          id="faq-title"
          className="mb-8 text-[clamp(1.75rem,3.4vw,2.5rem)] leading-[1.1] font-bold tracking-[-0.02em]"
        >
          Questions
        </h2>
      </Reveal>
      <FaqAccordion items={FAQ} />
    </section>
  );
}
