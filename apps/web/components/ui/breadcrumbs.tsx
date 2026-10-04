import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Fragment } from 'react';
import { cn } from '@/lib/utils';

export type Crumb = { label: string; href?: string };

// On a narrow screen the middle crumbs collapse to an ellipsis for the eye only; a screen
// reader still hears the whole trail.
export function Breadcrumbs({ trail, className }: { trail: Crumb[]; className?: string }) {
  const last = trail.length - 1;

  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0 max-w-full', className)}>
      <ol className="flex min-w-0 items-center gap-2 text-small text-mut">
        {trail.map((crumb, index) => {
          const current = index === last;
          const middle = index > 0 && !current;
          return (
            <Fragment key={`${index}-${crumb.label}`}>
              {index === 1 && last > 1 ? (
                <li aria-hidden className="flex items-center gap-2 sm:hidden">
                  <span>…</span>
                  <ChevronRight className="size-3.5 text-faint" />
                </li>
              ) : null}
              <li
                className={cn(
                  'flex min-w-0 items-center gap-2',
                  middle && 'max-sm:sr-only',
                  current ? 'shrink' : 'shrink-0',
                )}
              >
                {current || !crumb.href ? (
                  <span
                    aria-current={current ? 'page' : undefined}
                    title={crumb.label}
                    className={cn(
                      'min-w-0 truncate',
                      current ? 'max-w-full text-tx sm:max-w-80' : 'max-w-40',
                    )}
                  >
                    {crumb.label}
                  </span>
                ) : (
                  <Link
                    href={crumb.href}
                    title={crumb.label}
                    className="focus-ring max-w-40 truncate rounded-tag hover:text-pri"
                  >
                    {crumb.label}
                  </Link>
                )}
                {current ? null : (
                  <ChevronRight aria-hidden className="size-3.5 shrink-0 text-faint" />
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
