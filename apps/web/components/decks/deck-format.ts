import type { DeckFormat } from '@pokedrop/shared';

export const FORMAT_LABELS: Record<DeckFormat, string> = {
  standard: 'Standard',
  expanded: 'Expanded',
  unlimited: 'Unlimited',
};

export function formatLabel(format: string): string {
  return format in FORMAT_LABELS ? FORMAT_LABELS[format as DeckFormat] : format;
}
