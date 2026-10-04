'use client';

import type { LucideIcon } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { type ReactElement, type ReactNode, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

type Tone = 'default' | 'danger' | 'success';

const BADGE: Record<Tone, string> = {
  default: 'bg-linear-150 from-pri to-pri-dim text-on-pri',
  danger: 'bg-red-dim text-red',
  success: 'bg-grn/14 text-grn',
};

const CONFIRM = { default: 'primary', danger: 'destructive', success: 'confirm' } as const;

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  /** Opens the dialog and gets focus back when it closes. Without one, focus returns to
   * whatever had it when the dialog opened. */
  trigger?: ReactElement;
  children?: ReactNode;
  /** The footer: Cancel plus a confirm button, when `onConfirm` is given. */
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  /** The confirm action is in flight: its button spins, and the dialog cannot be dismissed. */
  confirming?: boolean;
  className?: string;
};

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  icon: Icon,
  tone = 'default',
  trigger,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  confirming = false,
  className,
}: DialogProps) {
  const returnTo = useRef<HTMLElement | null>(null);

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && confirming) return;
        if (next) returnTo.current = document.activeElement as HTMLElement | null;
        onOpenChange(next);
      }}
    >
      {trigger ? <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger> : null}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim backdrop-blur-scrim data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          aria-modal="true"
          onOpenAutoFocus={() => {
            returnTo.current ??= document.activeElement as HTMLElement | null;
          }}
          onCloseAutoFocus={(event) => {
            // Radix returns focus only to its own Trigger; a dialog opened from code would drop
            // focus to <body>.
            if (!trigger && returnTo.current?.isConnected) {
              event.preventDefault();
              returnTo.current.focus();
            }
            returnTo.current = null;
          }}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-110 -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-modal border border-bd-2 bg-surface p-6.5 shadow-lg outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            className,
          )}
        >
          {Icon ? (
            <span
              aria-hidden
              className={cn(
                'mb-4.5 flex size-13 items-center justify-center rounded-card',
                BADGE[tone],
              )}
            >
              <Icon className="size-6" />
            </span>
          ) : null}
          <DialogPrimitive.Title className="text-h2 font-bold">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="mt-1.5 text-body leading-normal text-mut">
              {description}
            </DialogPrimitive.Description>
          ) : null}
          {children ? <div className="mt-5">{children}</div> : null}
          {onConfirm ? (
            <div className="mt-5 flex gap-2.5">
              <DialogPrimitive.Close asChild>
                <Button variant="secondary" className="flex-1" disabled={confirming}>
                  {cancelLabel}
                </Button>
              </DialogPrimitive.Close>
              <Button
                variant={CONFIRM[tone]}
                className="flex-1"
                loading={confirming}
                onClick={onConfirm}
              >
                {confirmLabel}
              </Button>
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
