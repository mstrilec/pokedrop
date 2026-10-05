import type { Metadata } from 'next';
import { SetsGallery } from '@/components/catalog/sets-gallery';

export const metadata: Metadata = {
  title: 'Sets',
  description: 'Every Pokémon TCG expansion in the PokéDrop catalog, with your completion.',
};

export default function SetsPage() {
  return <SetsGallery />;
}
