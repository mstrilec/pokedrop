import {
  PackTemplateViewSchema,
  type PackTemplate,
  type PackTemplateContents,
  type PackTemplateView,
} from '@pokedrop/shared';
import { ladderOf } from './pack-generator.js';

export function toTemplateView(template: PackTemplate): PackTemplateView {
  const slots = template.slotConfig.slots.map((slot) => {
    const ladder = ladderOf(slot.weights);
    const total = ladder.reduce((sum, rung) => sum + rung.weight, 0);
    return {
      count: slot.count,
      odds: ladder.map((rung) => ({
        rarity: rung.rarity,
        percent: Math.round((rung.weight / total) * 1000) / 10,
      })),
    };
  });
  const contents: PackTemplateContents = {
    cardCount: slots.reduce((sum, slot) => sum + slot.count, 0),
    slots,
  };

  return PackTemplateViewSchema.parse({ ...template, contents, guarantee: guaranteeOf(contents) });
}

// A slot's most common rarity is its floor, the same ladder the generator
// walks: "1 Rare or better" means every other rarity in that slot is rarer.
function guaranteeOf(contents: PackTemplateContents): string {
  const parts = contents.slots.flatMap((slot) => {
    const floor = slot.odds[0];
    if (floor === undefined) {
      return [];
    }
    return [`${slot.count} ${floor.rarity}${slot.odds.length > 1 ? ' or better' : ''}`];
  });
  return `${contents.cardCount} cards: ${parts.join(', ')}.`;
}
