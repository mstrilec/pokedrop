import { Avatar as AvatarPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

type AvatarProps = {
  name: string;
  src?: string | null;
  /** Square side in px, 28–88. */
  size?: number;
  ring?: boolean;
  /** Inside a control that already names the person, hide the avatar from assistive tech. */
  decorative?: boolean;
  className?: string;
};

export function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

export function Avatar({
  name,
  src,
  size = 34,
  ring = false,
  decorative = false,
  className,
}: AvatarProps) {
  const side = Math.min(88, Math.max(28, size));

  return (
    <AvatarPrimitive.Root
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      className={cn(
        'relative inline-flex shrink-0 overflow-hidden select-none',
        ring && 'ring-2 ring-pri ring-offset-2 ring-offset-bg',
        className,
      )}
      style={{ width: side, height: side, borderRadius: Math.round(side * 0.26) }}
    >
      {src ? <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" /> : null}
      <AvatarPrimitive.Fallback
        aria-hidden
        className="flex size-full items-center justify-center bg-linear-135 from-pri to-rarity-ultra font-bold text-on-pri"
        style={{ fontSize: Math.round(side * 0.4) }}
      >
        {initialOf(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
