'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

export const DeckStatsPanel = dynamic(
  () => import('./deck-stats-charts').then((module) => module.DeckStatsCharts),
  { ssr: false, loading: () => <Skeleton shape="block" height="18rem" /> },
);
