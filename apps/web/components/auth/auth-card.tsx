import { CircleAlert, CircleCheck, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function AuthNotice({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  const Icon = tone === 'error' ? CircleAlert : CircleCheck;
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'mb-4 flex items-center gap-2 rounded-control border px-3 py-2 text-small',
        tone === 'error' ? 'border-red/30 bg-red-dim text-red' : 'border-grn/30 bg-grn/10 text-grn',
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      {children}
    </p>
  );
}

export function AuthCard({
  icon: Icon,
  title,
  description,
  children,
  footer,
}: {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="w-full max-w-105">
      <section className="rounded-modal border border-bd bg-surface px-8 py-8.5 shadow-lg">
        <span className="mb-5.5 flex size-11 items-center justify-center rounded-control bg-linear-135 from-pri to-pri-hover shadow-glow">
          <Icon aria-hidden className="size-5.5 text-on-pri" />
        </span>
        <h1 className="mb-1.5 text-h1 font-bold tracking-tight">{title}</h1>
        <p className="mb-6.5 text-body leading-normal text-mut">{description}</p>
        {children}
        {footer ? <div className="mt-5 text-center text-body text-mut">{footer}</div> : null}
      </section>
    </div>
  );
}
