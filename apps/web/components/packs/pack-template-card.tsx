import { Coins, Star } from 'lucide-react';
import { type CSSProperties, useId } from 'react';
import { Button } from '@/components/ui/button';
import { energyStyle } from '@/lib/design/energy';
import { formatCoins } from '@/lib/format';
import { cn } from '@/lib/utils';

type PackTemplateCardProps = {
  template: { name: string; cost: number; cardCount: number; guarantee: string };
  /** The energy type that colors the pack art. */
  type?: string;
  /** A ribbon such as `Latest` or `Premium`; decorative, never the only signal. */
  tag?: string;
  /** The member's coins; below the cost the pack cannot be opened, and says why. */
  balance?: number | null;
  onOpen: () => void;
  className?: string;
};

export function PackTemplateCard({
  template,
  type = 'Colorless',
  tag,
  balance,
  onOpen,
  className,
}: PackTemplateCardProps) {
  const shortfallId = useId();
  const energy = energyStyle(type);
  const Icon = energy.icon;
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
      <div
        className="relative flex h-42.5 items-center justify-center bg-card-face"
        style={{ '--energy': energy.face } as CSSProperties}
      >
        <Icon aria-hidden className="size-14.5 text-white/95" />
        {tag ? (
          <span className="absolute top-3 left-3 rounded-pill bg-black/45 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
            {tag}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-3.5 p-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-h3">{template.name}</h3>
          <p className="flex flex-wrap items-center gap-2 text-small text-mut">
            <span>{template.cardCount} cards</span>
            <span aria-hidden className="size-0.75 rounded-pill bg-faint" />
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
