'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

// Recharts loads with the panel only, never with the rest of the page.
export const DeckStatsPanel = dynamic(
  () => import('./deck-stats-charts').then((module) => module.DeckStatsCharts),
  { ssr: false, loading: () => <Skeleton shape="block" height="18rem" /> },
);
