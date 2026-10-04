import { PackArt } from './pack-art';

export function OpeningStage({ name, slow }: { name: string; slow: boolean }) {
  return (
    <div className="flex flex-col items-center gap-11">
      <div className="relative">
        <div className="animate-shake">
          <span
            aria-hidden
            className="absolute -inset-17.5 animate-pulse-glow rounded-pill bg-pri/60 blur-2xl"
          />
          <PackArt name={name} />
        </div>
        <span
          aria-hidden
          className="absolute inset-0 m-auto size-75 animate-flash rounded-pill bg-[radial-gradient(circle,var(--tx),var(--pri)_40%,transparent_70%)]"
        />
      </div>
      <p role="status" className="h-6 text-body text-mut">
        {slow ? 'Still opening…' : ''}
      </p>
    </div>
  );
}
