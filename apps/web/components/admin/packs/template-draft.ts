import {
  type CreatePackTemplate,
  CreatePackTemplateSchema,
  type PackTemplate,
  type SlotConfig,
} from '@pokedrop/shared';

export type WeightRow = { rarity: string; weight: string };
export type DraftSlot = { count: string; rows: WeightRow[] };
export type TemplateDraft = {
  name: string;
  cost: string;
  setIds: string[];
  slots: DraftSlot[];
  active: boolean;
};

export const NEW_DRAFT: TemplateDraft = {
  name: '',
  cost: '300',
  setIds: [],
  slots: [{ count: '1', rows: [{ rarity: 'Common', weight: '100' }] }],
  active: false,
};

export function draftOf(template: PackTemplate): TemplateDraft {
  return {
    name: template.name,
    cost: String(template.cost),
    setIds: template.setFilter.setIds,
    slots: template.slotConfig.slots.map((slot) => ({
      count: String(slot.count),
      rows: Object.entries(slot.weights).map(([rarity, weight]) => ({
        rarity,
        weight: String(weight),
      })),
    })),
    active: template.active,
  };
}

// The inputs hold strings; an empty or partial number is NaN, which the schema refuses by name.
const number = (value: string) => (value.trim() === '' ? Number.NaN : Number(value));

export function bodyOf(draft: TemplateDraft): CreatePackTemplate {
  return {
    name: draft.name,
    cost: number(draft.cost),
    // Ids from the sets list; the API checks each one exists.
    setFilter: { setIds: draft.setIds as CreatePackTemplate['setFilter']['setIds'] },
    slotConfig: {
      slots: draft.slots.map((slot) => ({
        count: number(slot.count),
        weights: Object.fromEntries(
          slot.rows.map((row) => [row.rarity.trim(), number(row.weight)]),
        ),
      })),
    },
    active: draft.active,
  };
}

/**
 * Where each problem shows: `name`, `cost`, `sets`, `slots` (the whole pack), `slot.<i>` and
 * `slot.<i>.row.<j>`. The rules are the shared `CreatePackTemplateSchema` the API validates
 * with, plus what the form's rows can express that a record cannot: a rarity named twice.
 */
export type Problems = Map<string, string>;

export function problemsOf(draft: TemplateDraft): Problems {
  const problems: Problems = new Map();
  const add = (key: string, message: string) => {
    if (!problems.has(key)) problems.set(key, message);
  };

  draft.slots.forEach((slot, i) => {
    const seen = new Set<string>();
    slot.rows.forEach((row, j) => {
      const rarity = row.rarity.trim();
      if (rarity === '') add(`slot.${i}.row.${j}`, 'Choose a rarity');
      else if (seen.has(rarity)) add(`slot.${i}.row.${j}`, `${rarity} is already in this slot`);
      seen.add(rarity);
    });
  });

  const parsed = CreatePackTemplateSchema.safeParse(bodyOf(draft));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const [head, kind, index, field, rarity] = issue.path;
      if (head === 'name') add('name', 'Name the pack (1–100 characters)');
      else if (head === 'cost') add('cost', 'A whole number of coins, 0 to 1,000,000');
      else if (head === 'setFilter') add('sets', 'Choose 1 to 50 sets');
      else if (head === 'slotConfig' && kind === 'slots' && typeof index === 'number') {
        if (field === 'count') add(`slot.${index}`, 'Cards in a slot: a whole number from 1 to 20');
        else if (field === 'weights' && typeof rarity === 'string') {
          const row = draft.slots[index]?.rows.findIndex((r) => r.rarity.trim() === rarity) ?? -1;
          add(
            row >= 0 ? `slot.${index}.row.${row}` : `slot.${index}`,
            'A weight is a whole number, 0 to 1,000,000',
          );
        } else add(`slot.${index}`, issue.message);
      } else if (head === 'slotConfig') add('slots', issue.message);
      else add('form', issue.message);
    }
  }
  return problems;
}

/** The config to preview: only slots whose numbers are usable, so the preview never shows NaN. */
export function previewSlots(draft: TemplateDraft): SlotConfig['slots'] {
  return bodyOf(draft).slotConfig.slots.filter(
    (slot) =>
      Number.isInteger(slot.count) &&
      slot.count > 0 &&
      Object.entries(slot.weights).every(
        ([rarity, w]) => rarity !== '' && Number.isInteger(w) && w >= 0,
      ) &&
      Object.values(slot.weights).some((w) => w > 0),
  );
}

/** Only what changed, so a rename never re-runs the pool check (docs/API.md *Packs*). */
export function changesOf(original: PackTemplate, body: CreatePackTemplate) {
  const changes: Partial<CreatePackTemplate> = {};
  if (body.name !== original.name) changes.name = body.name;
  if (body.cost !== original.cost) changes.cost = body.cost;
  if (
    JSON.stringify([...body.setFilter.setIds].sort()) !==
    JSON.stringify([...original.setFilter.setIds].sort())
  ) {
    changes.setFilter = body.setFilter;
  }
  if (!sameSlots(body.slotConfig, original.slotConfig)) changes.slotConfig = body.slotConfig;
  return changes;
}

function sameSlots(a: SlotConfig, b: SlotConfig): boolean {
  if (a.slots.length !== b.slots.length) return false;
  return a.slots.every((slot, i) => {
    const other = b.slots[i];
    if (!other || other.count !== slot.count) return false;
    const keys = Object.keys(slot.weights);
    return (
      keys.length === Object.keys(other.weights).length &&
      keys.every((key) => other.weights[key] === slot.weights[key])
    );
  });
}
