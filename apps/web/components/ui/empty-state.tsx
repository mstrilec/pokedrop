import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Button } from './button';

type Tone = 'primary' | 'economy' | 'accent' | 'neutral';

const TINTS: Record<Tone, string> = {
  primary: 'bg-pri-dim text-pri',
  economy: 'bg-gold-dim text-gold',
  accent: 'bg-rarity-ultra-tint text-rarity-ultra',
  neutral: 'bg-surface-2 text-mut',
};

type Cta = { label: string; icon?: LucideIcon } & (
  { href: string; onClick?: never } | { onClick: () => void; href?: never }
);

/** Never a dead end: a soft badge, one line of why, and the one thing to do next. */
export function EmptyState({
  icon: Icon,
  title,
  body,
  cta,
  tone = 'primary',
  className,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  cta?: Cta;
  tone?: Tone;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'flex flex-col items-center rounded-card border border-bd bg-surface px-7 py-10 text-center',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn('mb-4.5 flex size-15 items-center justify-center rounded-card', TINTS[tone])}
      >
        <Icon className="size-6.5" />
      </span>
      <h2 className="text-h3 font-semibold">{title}</h2>
      <p className="mt-1.5 max-w-72 text-small leading-relaxed text-mut">{body}</p>
      {cta ? (
        cta.href !== undefined ? (
          <Button asChild icon={cta.icon} size="sm" className="mt-5 h-10 px-4.5">
            <Link href={cta.href}>{cta.label}</Link>
          </Button>
        ) : (
          <Button icon={cta.icon} size="sm" className="mt-5 h-10 px-4.5" onClick={cta.onClick}>
            {cta.label}
          </Button>
        )
      ) : null}
    </section>
  );
}
