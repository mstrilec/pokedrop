import { Zap } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export function Logo({ href, className }: { href: string; className?: string }) {
  return (
    <Link href={href} className={cn('focus-ring flex items-center gap-3', className)}>
      <span className="flex size-8 items-center justify-center rounded-control bg-linear-135 from-pri to-pri-hover shadow-glow">
        <Zap aria-hidden className="size-4 text-on-pri" />
      </span>
      <span className="text-h3 font-bold tracking-tight">
        Poké<span className="text-pri">Drop</span>
      </span>
    </Link>
  );
}
