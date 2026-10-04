import type { ReactNode } from 'react';

export function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex flex-col gap-6">
      <h2 id={`${id}-title`} className="text-caption text-faint uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Specimen({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 rounded-card border border-bd bg-surface p-6">
      <h3 className="text-h3">{name}</h3>
      {children}
    </div>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-small text-faint">{label}</span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}
