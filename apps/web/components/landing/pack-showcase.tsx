'use client';

import { PackArtSchema } from '@pokedrop/shared';
import { ArrowRight, PackageOpen } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { BoosterPack } from '@/components/packs/booster-pack';
import { Button } from '@/components/ui/button';
import { RARITY_STYLES, rarityTier } from '@/lib/design/rarity';
import { cn } from '@/lib/utils';
import type { PackShowcaseHandle } from './three/pack-showcase';
import { useThreeMode } from './use-three-mode';

// Eight cards the seed's Base Set Booster Pack can hold in one opening:
// four Common, three Uncommon and its one rare slot.
const FAN = [
  { id: 'base1-58', name: 'Pikachu', rarity: 'Common' },
  { id: 'base1-44', name: 'Bulbasaur', rarity: 'Common' },
  { id: 'base1-63', name: 'Squirtle', rarity: 'Common' },
  { id: 'base1-46', name: 'Charmander', rarity: 'Common' },
  { id: 'base1-24', name: 'Charmeleon', rarity: 'Uncommon' },
  { id: 'base1-30', name: 'Ivysaur', rarity: 'Uncommon' },
  { id: 'base1-42', name: 'Wartortle', rarity: 'Uncommon' },
  { id: 'base1-4', name: 'Charizard', rarity: 'Rare Holo' },
] as const;

const image = (id: string) => `https://images.pokemontcg.io/base1/${id.split('-')[1]}.png`;
const LOGO = 'https://images.pokemontcg.io/base1/logo.png';
const PACK_NAME = 'Base Set Booster Pack';

const ART = PackArtSchema.parse({
  set: { id: 'base1', name: 'Base', series: 'Base', logoUrl: LOGO },
  cover: {
    id: 'base1-4',
    name: 'Charizard',
    image: image('base1-4'),
    type: 'Fire',
    rarity: 'Rare Holo',
  },
  coverIsDefault: true,
  imageUrl: null,
});

const STAGES = ['Sealed', 'Torn open', 'Revealed'];
const stageOf = (p: number) => (p < 0.12 ? 0 : p < 0.5 ? 1 : 2);

// The poster's fan: an arc of radius R, `spread` radians between cards, narrow
// enough that eight cards stay inside the stage column.
function fanTransform(i: number, R: number, spread: number, lift: number) {
  const th = (i - (FAN.length - 1) / 2) * spread;
  const x = R * Math.sin(th);
  const y = R * (1 - Math.cos(th)) - lift;
  return `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${th.toFixed(3)}rad)`;
}
const FAN_STYLE = FAN.map(
  (_, i) =>
    ({
      '--fan-sm': fanTransform(i, 330, 0.1, 10),
      '--fan-lg': fanTransform(i, 560, 0.13, 20),
    }) as CSSProperties,
);

export function PackShowcase({ signedIn }: { signedIn: boolean }) {
  const mode = useThreeMode();
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [stage, setStage] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const scrub = mode === 'full' && !failed;
  // The signed-in shell's bar is sticky and 60 px tall (h-15); the guest header scrolls away.
  const top = signedIn ? 60 : 0;

  useEffect(() => {
    const section = sectionRef.current;
    const mount = mountRef.current;
    if (!scrub || !section || !mount) return;
    let handle: PackShowcaseHandle | null = null;
    let gone = false;
    let frame = 0;

    const progress = () => {
      const rect = section.getBoundingClientRect();
      const span = rect.height - (window.innerHeight - top);
      return Math.min(1, Math.max(0, (top - rect.top) / Math.max(1, span)));
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const p = progress();
        handle?.setProgress(p);
        setStage(stageOf(p));
      });
    };
    const onResize = () => handle?.setCompact(window.innerWidth < 640);

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        void import('./three/pack-showcase').then(async ({ init }) => {
          if (gone) return;
          const h = await init(mount, {
            cards: FAN.map((card) => ({
              image: image(card.id),
              holo: card.rarity === 'Rare Holo',
            })),
            cover: image('base1-4'),
            logo: LOGO,
            packName: PACK_NAME,
            compact: window.innerWidth < 640,
            onReady: () => setReady(true),
            onFallback: () => {
              setReady(false);
              setFailed(true);
            },
          });
          if (gone) {
            h.dispose();
            return;
          }
          handle = h;
          h.setProgress(progress());
        });
      },
      { rootMargin: '800px 0px' },
    );
    io.observe(section);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    onScroll();
    return () => {
      gone = true;
      io.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      handle?.dispose();
    };
  }, [scrub, top]);

  return (
    <section
      ref={sectionRef}
      id="pack-opening"
      aria-labelledby="show-title"
      className={cn('relative scroll-mt-20', scrub && 'h-[260vh]')}
    >
      <div
        style={scrub ? { top, height: `calc(100dvh - ${top}px)` } : undefined}
        className={cn(
          'overflow-hidden border-y border-bd bg-[radial-gradient(900px_520px_at_70%_55%,color-mix(in_srgb,var(--e-fire)_14%,transparent),transparent_70%)]',
          scrub ? 'sticky' : 'relative',
        )}
      >
        <div
          className={cn(
            'mx-auto grid h-full max-w-300 items-center gap-8 px-5 sm:px-14 lg:grid-cols-[0.85fr_1.15fr] lg:gap-12',
            scrub ? 'grid-rows-[auto_minmax(0,1fr)] py-8 lg:grid-rows-1' : 'py-14 sm:py-20',
          )}
        >
          <div className="flex min-w-0 flex-col gap-4">
            <p className="inline-flex items-center gap-2 text-caption text-energy-fire uppercase">
              <PackageOpen aria-hidden className="size-4" />
              Pack opening
            </p>
            <h2
              id="show-title"
              className="text-[clamp(1.75rem,3.4vw,2.5rem)] leading-[1.1] font-bold tracking-[-0.02em] text-balance"
            >
              Rip a pack. See the odds first.
            </h2>
            <p className="max-w-105 text-[1rem] leading-relaxed text-pretty text-mut">
              Every pack lists its odds before you open it.
            </p>
            {scrub ? (
              <ol aria-hidden className="mt-2 flex flex-wrap gap-2">
                {STAGES.map((label, i) => (
                  <li
                    key={label}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-pill border px-3 py-1.5 text-small font-semibold transition-colors',
                      i === stage
                        ? 'border-energy-fire/60 bg-energy-fire/16 text-tx'
                        : 'border-bd text-mut',
                    )}
                  >
                    <span className="font-mono text-caption opacity-80">0{i + 1}</span>
                    {label}
                  </li>
                ))}
              </ol>
            ) : null}
            <div className="mt-2 flex flex-col gap-3">
              <p className="text-caption text-faint uppercase">An example pull</p>
              <ul className="flex flex-wrap gap-2">
                {FAN.map((card) => {
                  const style = RARITY_STYLES[rarityTier(card.rarity)];
                  return (
                    <li
                      key={card.id}
                      className={cn(
                        'inline-flex items-center gap-2 rounded-pill border px-2.5 py-1 text-small',
                        style.chip,
                      )}
                    >
                      <span
                        aria-hidden
                        className="size-1.75 rounded-pill"
                        style={{ background: style.color }}
                      />
                      <span className="font-medium text-tx">{card.name}</span>
                      <span className="font-semibold">{card.rarity}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="mt-2">
              <Button asChild variant="secondary" icon={ArrowRight}>
                {signedIn ? (
                  <Link href="/packs">Browse packs</Link>
                ) : (
                  <Link href="/register">Create an account to open one</Link>
                )}
              </Button>
            </div>
          </div>

          <div
            role="img"
            aria-label="A Base Set booster tears open and fans out eight cards: Pikachu, Bulbasaur, Squirtle, Charmander, Charmeleon, Ivysaur, Wartortle and Charizard."
            className={cn('relative h-full min-w-0', scrub ? 'min-h-0' : 'min-h-90 sm:min-h-130')}
          >
            <div
              aria-hidden
              className="absolute top-1/2 left-1/2 aspect-[1.4] w-[min(90%,620px)] -translate-1/2 rounded-pill bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--e-fire)_32%,transparent),color-mix(in_srgb,var(--gold)_12%,transparent)_55%,transparent)] blur-md"
            />
            {scrub ? (
              <div
                aria-hidden
                className={cn(
                  'absolute top-1/2 left-1/2 -translate-1/2 transition-opacity duration-500',
                  ready && 'opacity-0',
                )}
              >
                <div className="animate-float-pack">
                  <BoosterPack art={ART} name={PACK_NAME} size="lg" sheen="loop" />
                </div>
              </div>
            ) : (
              <div aria-hidden className="absolute inset-0">
                {FAN.map((card, i) => (
                  <div
                    key={card.id}
                    style={FAN_STYLE[i]}
                    className="absolute top-1/2 left-1/2 aspect-[63/88] w-21 [transform:var(--fan-sm)] sm:w-35 sm:[transform:var(--fan-lg)]"
                  >
                    <Image
                      src={image(card.id)}
                      alt=""
                      fill
                      sizes="(min-width: 640px) 140px, 84px"
                      className={cn(
                        'rounded-[9px] border object-cover shadow-md',
                        card.rarity === 'Rare Holo'
                          ? 'border-rarity-rare/60 shadow-[0_0_22px_color-mix(in_srgb,var(--c-rare)_35%,transparent)]'
                          : 'border-bd-2',
                      )}
                    />
                  </div>
                ))}
              </div>
            )}
            <div ref={mountRef} className="absolute inset-0" />
          </div>
        </div>
      </div>
    </section>
  );
}
