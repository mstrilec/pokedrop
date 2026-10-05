import type { Metadata } from 'next';
import { CatalogView } from '@/components/catalog/catalog-view';

export const metadata: Metadata = {
  title: 'Browse cards',
  description: 'Search and filter every Pokémon TCG card in the PokéDrop catalog.',
};

export default function CatalogPage() {
  return <CatalogView />;
}
