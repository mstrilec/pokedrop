import type { PackArt } from '@pokedrop/shared';
import { Coins, Star } from 'lucide-react';
import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { formatCoins } from '@/lib/format';
import { cn } from '@/lib/utils';
import { BoosterPack } from './booster-pack';

type PackTemplateCardProps = {
  template: { name: string; cost: number; cardCount: number; guarantee: string };
  /** The wrapper's art; null draws a plain one. */
  art: PackArt | null;
  /** A ribbon such as `Latest` or `Premium`; decorative, never the only signal. */
  tag?: string;
  /** The member's coins; below the cost the pack cannot be opened, and says why. */
  balance?: number | null;
  onOpen: () => void;
  className?: string;
};

export function PackTemplateCard({
  template,
  art,
  tag,
  balance,
  onOpen,
  className,
}: PackTemplateCardProps) {
  const shortfallId = useId();
  const shortfall = typeof balance === 'number' ? template.cost - balance : 0;
  const unaffordable = shortfall > 0;

  return (
    <article
      aria-label={template.name}
      className={cn(
        'overflow-hidden rounded-card border border-bd bg-surface transition hover:-translate-y-1 hover:border-pri',
        className,
      )}
    >
      <div className="group/pack relative flex h-64 items-center justify-center overflow-hidden bg-surface-2">
        <BoosterPack
          art={art}
          name={template.name}
          cardCount={template.cardCount}
          size="md"
          sheen="hover"
          className="-rotate-6 transition duration-300 motion-safe:group-hover/pack:-translate-y-1.5 motion-safe:group-hover/pack:rotate-0"
        />
        {tag ? (
          <span className="absolute top-3 left-3 rounded-pill bg-art-scrim/60 px-2.5 py-1 text-[11px] font-semibold text-on-art backdrop-blur-sm">
            {tag}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-3.5 p-4">
        <div className="flex flex-col gap-1">
          {art ? (
            <p className="text-small text-faint">
              {art.set.series === '' || art.set.name === art.set.series
                ? art.set.name
                : `${art.set.name} · ${art.set.series}`}
            </p>
          ) : null}
          <h3 className="text-h3">{template.name}</h3>
          <p className="flex flex-wrap items-center gap-2 text-small text-mut">
            <span className="inline-flex items-center gap-1">
              <Star aria-hidden className="size-3 text-gold" />
              {template.guarantee}
            </span>
          </p>
        </div>
        <Button
          icon={Coins}
          onClick={onOpen}
          disabled={unaffordable}
          aria-label={`Open ${template.name} for ${template.cost.toLocaleString('en-US')} coins`}
          aria-describedby={unaffordable ? shortfallId : undefined}
          className="w-full"
        >
          {formatCoins(template.cost)} · Open
        </Button>
        {unaffordable ? (
          <p id={shortfallId} className="-mt-1.5 text-center text-small text-faint">
            You need {shortfall.toLocaleString('en-US')} more coins.
          </p>
        ) : null}
      </div>
    </article>
  );
}
