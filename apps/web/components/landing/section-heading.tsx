import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Reveal } from './reveal';

export function SectionHeading({
  id,
  eyebrow,
  icon: Icon,
  tone,
  title,
  lead,
  className,
}: {
  id: string;
  eyebrow: string;
  icon: LucideIcon;
  /** A text colour class for the eyebrow, e.g. `text-energy-fire`. */
  tone: string;
  title: ReactNode;
  lead?: ReactNode;
  className?: string;
}) {
  return (
    <Reveal className={cn('flex max-w-155 flex-col gap-3', className)}>
      <p className={cn('inline-flex items-center gap-2 text-caption uppercase', tone)}>
        <Icon aria-hidden className="size-4" />
        {eyebrow}
      </p>
      <h2
        id={id}
        className="text-[clamp(1.75rem,3.4vw,2.5rem)] leading-[1.1] font-bold tracking-[-0.02em] text-balance"
      >
        {title}
      </h2>
      {lead ? <p className="text-[1rem] leading-relaxed text-pretty text-mut">{lead}</p> : null}
    </Reveal>
  );
}
