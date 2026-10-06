import type { Card, PriceHistory, SetDetail } from '@pokedrop/shared';
import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CardArt } from '@/components/cards/card-art';
import { cardView } from '@/components/cards/card-data';
import { Badge } from '@/components/ui/badge';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { energyStyle } from '@/lib/design/energy';
import { rarityTier } from '@/lib/design/rarity';
import { isOptimizable } from '@/lib/images';
import { cn } from '@/lib/utils';
import { CardActions } from './card-actions';
import { CardPrices } from './card-prices';

/** The number printed on the card: what follows the set id in the card id. */
export function cardNumber(id: string): string {
  return id.slice(id.lastIndexOf('-') + 1);
}

function Energies({ types, label }: { types: string[]; label: string }) {
  if (types.length === 0) return <span className="text-mut">None</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="sr-only">
        {label}: {types.join(', ')}
      </span>
      {types.map((type, index) => {
        const energy = energyStyle(type);
        const Icon = energy.icon;
        return (
          <span
            key={`${index}-${type}`}
            aria-hidden
            title={type}
            className={cn(
              'flex size-5 items-center justify-center rounded-pill border border-bd-2 bg-surface-2',
              energy.text,
            )}
          >
            <Icon className="size-3" />
          </span>
        );
      })}
    </span>
  );
}

function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-card border border-bd bg-surface p-5"
    >
      <h2 id={id} className="text-h3">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Moves({ card }: { card: Card }) {
  if (card.abilities.length === 0 && card.attacks.length === 0) return null;
  return (
    <Section title="Abilities and attacks" id="moves-heading">
      <ul className="flex flex-col divide-y divide-bd">
        {card.abilities.map((ability) => (
          <li key={`ability-${ability.name}`} className="flex flex-col gap-1 py-3 first:pt-0">
            <p className="flex flex-wrap items-center gap-2">
              <Badge label={ability.type} tone="accent" shape="tag" />
              <span className="font-semibold text-tx">{ability.name}</span>
            </p>
            <p className="text-small text-mut">{ability.text}</p>
          </li>
        ))}
        {card.attacks.map((attack) => (
          <li key={`attack-${attack.name}`} className="flex flex-col gap-1 py-3 first:pt-0">
            <p className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <Energies types={attack.cost} label="Cost" />
                <span className="font-semibold text-tx">{attack.name}</span>
              </span>
              {attack.damage ? (
                <span className="shrink-0 font-mono text-h3 text-tx">
                  <span className="sr-only">Damage </span>
                  {attack.damage}
                </span>
              ) : null}
            </p>
            {attack.text ? <p className="text-small text-mut">{attack.text}</p> : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Combat({ card }: { card: Card }) {
  const pokemon = card.supertype === 'Pokémon';
  const legal = Object.entries(card.legalities)
    .filter(([, state]) => state === 'Legal')
    .map(([format]) => format[0]!.toUpperCase() + format.slice(1));
  return (
    <Section title={pokemon ? 'Combat data' : 'Card data'} id="combat-heading">
      <dl className="flex flex-col divide-y divide-bd text-small">
        {pokemon ? (
          <>
            <Row term="Weakness">
              {card.weaknesses.length === 0
                ? 'None'
                : card.weaknesses.map((w) => `${w.type} ${w.value}`).join(', ')}
            </Row>
            <Row term="Resistance">
              {card.resistances.length === 0
                ? 'None'
                : card.resistances.map((r) => `${r.type} ${r.value}`).join(', ')}
            </Row>
            <Row term="Retreat cost">
              <Energies types={card.retreatCost} label="Retreat cost" />
            </Row>
          </>
        ) : null}
        <Row term="Card type">{[card.supertype, ...card.subtypes].join(' · ')}</Row>
        <Row term="Legal in">{legal.length === 0 ? 'No format' : legal.join(', ')}</Row>
      </dl>
    </Section>
  );
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-mut">{term}</dt>
      <dd className="text-right text-tx">{children}</dd>
    </div>
  );
}

function SetInfo({ set, number }: { set: SetDetail; number: string }) {
  return (
    <Section title="Set" id="set-heading">
      <div className="flex flex-wrap items-center gap-4">
        {set.logoUrl ? (
          <Image
            src={set.logoUrl}
            alt={`${set.name} logo`}
            width={120}
            height={48}
            unoptimized={!isOptimizable(set.logoUrl)}
            className="h-12 w-auto object-contain"
          />
        ) : null}
        <div className="flex min-w-0 flex-col">
          <p className="flex items-center gap-2 font-semibold text-tx">
            {set.symbolUrl ? (
              <Image
                src={set.symbolUrl}
                alt=""
                width={20}
                height={20}
                unoptimized={!isOptimizable(set.symbolUrl)}
                className="size-5 object-contain"
              />
            ) : null}
            {set.name}
          </p>
          <p className="text-small text-mut">
            {set.series} series · released{' '}
            <time dateTime={set.releaseDate.toISOString().slice(0, 10)}>
              {set.releaseDate.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                timeZone: 'UTC',
              })}
            </time>
          </p>
          <p className="font-mono text-small text-tx">
            No. {number}/{set.printedTotal}
          </p>
        </div>
      </div>
      <Link
        href={`/cards?set=${encodeURIComponent(set.id)}`}
        className="focus-ring self-start rounded-tag text-small text-pri hover:underline"
      >
        Browse the {set.name} set
      </Link>
    </Section>
  );
}

export function CardDetail({
  card,
  set,
  history,
  now,
  species,
}: {
  card: Card;
  set: SetDetail | null;
  history: PriceHistory | null;
  now: Date;
  /** The Pokédex section, streamed: it may be slow and may be absent. */
  species: ReactNode;
}) {
  const tier = rarityTier(card.rarity);
  const number = cardNumber(card.id);
  const art = { ...cardView(card), image: card.imageLarge };

  return (
    <>
      <Breadcrumbs
        trail={[
          { label: 'Browse', href: '/cards' },
          ...(set ? [{ label: set.name, href: `/cards?set=${encodeURIComponent(set.id)}` }] : []),
          { label: card.name },
        ]}
        className="mb-5"
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
          <div className="relative mx-auto aspect-[5/7] w-full max-w-88 overflow-hidden rounded-tile border border-bd bg-surface shadow-md">
            <CardArt card={art} size="large" sizes="(min-width: 1024px) 352px, 90vw" preload />
          </div>
          <CardActions cardId={card.id} cardName={card.name} />
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <header className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-h1 font-bold tracking-tight wrap-anywhere">{card.name}</h1>
              {card.rarity ? <Badge label={card.rarity} rarity={tier} /> : null}
              {card.types.map((type) => {
                const energy = energyStyle(type);
                return (
                  <Badge
                    key={type}
                    label={type}
                    icon={energy.icon}
                    className={cn('border border-bd-2 bg-surface-2', energy.text)}
                  />
                );
              })}
            </div>
            <p className="text-body text-mut">
              {[card.supertype, ...card.subtypes].join(' · ')}
              {card.hp !== null ? ` · HP ${card.hp}` : ''}
              {set ? ` · ${set.name} ${number}/${set.printedTotal}` : ''}
            </p>
          </header>

          <CardPrices
            usd={card.latestPriceUsd}
            eur={card.latestPriceEur}
            updatedAt={card.priceUpdatedAt}
            history={history}
            now={now}
          />

          <div className="grid gap-6 xl:grid-cols-2">
            <Moves card={card} />
            <Combat card={card} />
          </div>
          {set ? <SetInfo set={set} number={number} /> : null}
          {species}
        </div>
      </div>
    </>
  );
}
