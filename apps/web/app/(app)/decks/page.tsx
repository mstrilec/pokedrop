import type { Metadata } from 'next';
import { DecksList } from '@/components/decks/decks-list';

export const metadata: Metadata = { title: 'Decks' };

export default function DecksPage() {
  return <DecksList />;
}
