'use client';

import { Plus } from 'lucide-react';
import { Accordion } from 'radix-ui';

// Radix rather than <details>: the answer's height animates in every browser,
// where ::details-content does not reach Firefox.
export function FaqAccordion({ items }: { items: { q: string; a: string }[] }) {
  return (
    <Accordion.Root type="multiple" className="flex flex-col gap-2">
      {items.map(({ q, a }) => (
        <Accordion.Item
          key={q}
          value={q}
          className="rounded-card border border-bd bg-surface transition-colors data-[state=open]:border-bd-2"
        >
          <Accordion.Header asChild>
            <h3>
              <Accordion.Trigger className="group focus-ring flex w-full cursor-pointer items-center justify-between gap-4 rounded-card px-5 py-4.5 text-left text-h3">
                {q}
                <span
                  aria-hidden
                  className="flex size-7 flex-none items-center justify-center rounded-pill bg-surface-2 text-mut transition-transform duration-200 group-data-[state=open]:rotate-45"
                >
                  <Plus className="size-3.5" />
                </span>
              </Accordion.Trigger>
            </h3>
          </Accordion.Header>
          <Accordion.Content className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
            <p className="px-5 pb-5 text-[0.9375rem] leading-relaxed text-pretty text-mut">{a}</p>
          </Accordion.Content>
        </Accordion.Item>
      ))}
    </Accordion.Root>
  );
}
