'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import type { ReactNode } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { getQueryClient } from '@/lib/query/client';
import type { ThemePreference } from '@/lib/theme/theme';
import { ThemeProvider } from '@/lib/theme/theme-provider';
import { UiProvider } from '@/lib/stores/ui';

export function Providers({ theme, children }: { theme: ThemePreference; children: ReactNode }) {
  return (
    <ThemeProvider initial={theme}>
      <QueryClientProvider client={getQueryClient()}>
        <UiProvider>{children}</UiProvider>
        <Toaster />
        <ReactQueryDevtools />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
