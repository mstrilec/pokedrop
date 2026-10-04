import { Zap } from 'lucide-react';

export function PackArt({ name }: { name: string }) {
  return (
    <div className="relative h-102.5 w-75 overflow-hidden rounded-modal border border-white/20 bg-linear-160 from-pri to-rarity-ultra shadow-lg">
      <div
        aria-hidden
        className="absolute inset-y-0 w-17.5 animate-sweep bg-linear-90 from-transparent via-white/55 to-transparent"
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 p-6 text-center">
        <span className="flex size-20 items-center justify-center rounded-pill bg-white/15">
          <Zap aria-hidden className="size-10 text-white" />
        </span>
        <span className="text-h2 font-extrabold text-white">{name}</span>
      </div>
    </div>
  );
}
