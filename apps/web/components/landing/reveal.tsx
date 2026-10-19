'use client';

import { type CSSProperties, type ReactNode, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export function Reveal({
  children,
  className,
  style,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  as?: 'div' | 'li';
}) {
  const ref = useRef<HTMLDivElement & HTMLLIElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    el.dataset.hidden = '';
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        delete el.dataset.hidden;
        io.disconnect();
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      style={style}
      className={cn(
        'transition-[opacity,translate] duration-500 ease-reveal data-hidden:translate-y-4 data-hidden:opacity-0',
        className,
      )}
    >
      {children}
    </Tag>
  );
}
