'use client';

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

const Toaster = (props: ToasterProps) => (
  <Sonner
    theme="dark"
    className="toaster group"
    duration={4000}
    icons={{
      success: <CircleCheckIcon className="size-4" />,
      info: <InfoIcon className="size-4" />,
      warning: <TriangleAlertIcon className="size-4" />,
      error: <OctagonXIcon className="size-4" />,
      loading: <Loader2Icon className="size-4 animate-spin" />,
    }}
    style={
      {
        '--normal-bg': 'var(--elev)',
        '--normal-text': 'var(--tx)',
        '--normal-border': 'var(--bd2)',
      } as React.CSSProperties
    }
    toastOptions={{
      classNames: {
        toast: 'rounded-card! shadow-lg font-sans text-body',
        description: 'text-mut! font-mono text-small',
        success: '[&_[data-icon]]:text-grn',
        error: '[&_[data-icon]]:text-red',
        info: '[&_[data-icon]]:text-pri',
        warning: '[&_[data-icon]]:text-gold',
      },
    }}
    {...props}
  />
);

export { Toaster };
