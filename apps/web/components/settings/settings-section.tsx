import type { ReactNode } from 'react';

export function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="grid gap-5 rounded-card border border-bd bg-surface p-6 lg:grid-cols-[16rem_minmax(0,1fr)]"
    >
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-heading`} className="text-h3">
          {title}
        </h2>
        <p className="text-small text-mut">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
