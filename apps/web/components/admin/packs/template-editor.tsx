'use client';

import type { PackTemplate } from '@pokedrop/shared';
import { CircleAlert, Plus, Save, Trash2, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { useAdminPackTemplates, useSavePackTemplate } from '@/lib/query/admin';
import { useCatalogFacets, useSets } from '@/lib/query/catalog';
import { apiErrorMessage, toastApiError, toastSuccess } from '@/lib/toast';
import { OddsPreview } from './odds-preview';
import {
  bodyOf,
  changesOf,
  type DraftSlot,
  draftOf,
  NEW_DRAFT,
  previewSlots,
  problemsOf,
  type TemplateDraft,
} from './template-draft';

function Problem({ id, message }: { id?: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="flex items-center gap-1.5 text-small text-red">
      <CircleAlert aria-hidden className="size-3.5 shrink-0" />
      {message}
    </p>
  );
}

function SetPicker({
  setIds,
  onChange,
  problem,
}: {
  setIds: string[];
  onChange: (setIds: string[]) => void;
  problem: string | undefined;
}) {
  const sets = useSets();
  const [query, setQuery] = useState('');
  const problemId = useId();
  const byId = new Map<string, { name: string }>((sets.data ?? []).map((set) => [set.id, set]));
  const q = query.trim().toLowerCase();
  const matches =
    q.length === 0
      ? []
      : (sets.data ?? [])
          .filter((set) => !setIds.includes(set.id))
          .filter((set) => set.name.toLowerCase().includes(q) || set.id.toLowerCase().includes(q))
          .slice(0, 8);

  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={problem ? problemId : undefined}>
      <legend className="mb-1.5 text-small text-mut">Sets the cards come from</legend>
      {setIds.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {setIds.map((id) => (
            <li key={id}>
              <span className="flex items-center gap-1 rounded-pill border border-bd-2 bg-surface-2 py-1 pr-1 pl-3 text-small text-tx">
                {byId.get(id)?.name ?? id}
                <span className="font-mono text-[11px] text-faint">{id}</span>
                <button
                  type="button"
                  aria-label={`Remove ${byId.get(id)?.name ?? id}`}
                  onClick={() => onChange(setIds.filter((other) => other !== id))}
                  className="focus-ring flex size-5 cursor-pointer items-center justify-center rounded-pill text-mut hover:text-tx"
                >
                  <X aria-hidden className="size-3" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <Input
        label="Add a set"
        hideLabel
        placeholder="Add a set — type its name or id"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {matches.length > 0 ? (
        <ul
          aria-label="Matching sets"
          className="flex flex-col rounded-control border border-bd bg-bg"
        >
          {matches.map((set) => (
            <li key={set.id}>
              <button
                type="button"
                onClick={() => {
                  onChange([...setIds, set.id]);
                  setQuery('');
                }}
                className="focus-ring flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-small hover:bg-surface-2"
              >
                <span className="text-tx">{set.name}</span>
                <span className="font-mono text-[11px] text-faint">
                  {set.id} · {set.series}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Problem id={problemId} message={problem} />
    </fieldset>
  );
}

function SlotEditor({
  index,
  slot,
  rarities,
  problems,
  onChange,
  onRemove,
}: {
  index: number;
  slot: DraftSlot;
  rarities: string[];
  problems: Map<string, string>;
  onChange: (slot: DraftSlot) => void;
  onRemove: (() => void) | null;
}) {
  const listId = useId();
  const setRow = (j: number, row: Partial<DraftSlot['rows'][number]>) =>
    onChange({ ...slot, rows: slot.rows.map((r, k) => (k === j ? { ...r, ...row } : r)) });

  return (
    <fieldset className="flex flex-col gap-3 rounded-control border border-bd bg-bg p-4">
      <legend className="px-1 text-small font-semibold text-tx">Slot {index + 1}</legend>
      <div className="flex items-end gap-3">
        <Input
          label="Cards"
          type="number"
          inputMode="numeric"
          min={1}
          max={20}
          value={slot.count}
          onChange={(event) => onChange({ ...slot, count: event.target.value })}
          className="w-24"
        />
        {onRemove ? (
          <Button type="button" variant="ghost" size="sm" icon={Trash2} onClick={onRemove}>
            Remove slot
          </Button>
        ) : null}
      </div>
      <Problem message={problems.get(`slot.${index}`)} />
      <datalist id={listId}>
        {rarities.map((rarity) => (
          <option key={rarity} value={rarity} />
        ))}
      </datalist>
      <ul className="flex flex-col gap-2">
        {slot.rows.map((row, j) => (
          <li key={j} className="flex flex-col gap-1">
            <div className="flex items-start gap-2">
              <Input
                label="Rarity"
                list={listId}
                value={row.rarity}
                onChange={(event) => setRow(j, { rarity: event.target.value })}
                error={problems.get(`slot.${index}.row.${j}`)}
                className="min-w-0 flex-1"
              />
              <Input
                label="Weight"
                type="number"
                inputMode="numeric"
                min={0}
                value={row.weight}
                onChange={(event) => setRow(j, { weight: event.target.value })}
                className="w-28"
              />
              <button
                type="button"
                aria-label={`Remove ${row.rarity || 'this rarity'} from slot ${index + 1}`}
                disabled={slot.rows.length === 1}
                onClick={() => onChange({ ...slot, rows: slot.rows.filter((_, k) => k !== j) })}
                className="focus-ring mt-7 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-control text-mut hover:bg-surface-2 hover:text-tx disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        icon={Plus}
        className="self-start"
        onClick={() => onChange({ ...slot, rows: [...slot.rows, { rarity: '', weight: '1' }] })}
      >
        Add a rarity
      </Button>
    </fieldset>
  );
}

/** One template's form; keyed by the template, so a selection starts from its saved state. */
export function TemplateEditor({
  template,
  onSaved,
}: {
  template: PackTemplate | null;
  onSaved: (template: PackTemplate) => void;
}) {
  const facets = useCatalogFacets();
  const templates = useAdminPackTemplates();
  const save = useSavePackTemplate();
  const activate = useSavePackTemplate();
  const [draft, setDraft] = useState<TemplateDraft>(() =>
    template ? draftOf(template) : NEW_DRAFT,
  );
  const [serverError, setServerError] = useState<string | null>(null);
  const problems = useMemo(() => problemsOf(draft), [draft]);
  const rarities = (facets.data?.rarities ?? []).map((r) => r.value);
  const body = bodyOf(draft);
  const changes = template ? changesOf(template, body) : body;
  const dirty = Object.keys(changes).length > 0;
  const first = [...problems.values()][0];

  const edit = (next: Partial<TemplateDraft>) => {
    setServerError(null);
    setDraft((d) => ({ ...d, ...next }));
  };
  const setSlot = (i: number, slot: DraftSlot) =>
    edit({ slots: draft.slots.map((s, k) => (k === i ? slot : s)) });

  const submit = () => {
    if (problems.size > 0 || !dirty) return;
    save.mutate(
      { id: template?.id ?? null, body: template ? changes : body },
      {
        onSuccess: (saved) => {
          toastSuccess(template ? `Saved ${saved.name}` : `Created ${saved.name}`);
          onSaved(saved);
        },
        // The pool check (a rarity the chosen sets lack) and an unknown set are 400s.
        onError: (error) => setServerError(apiErrorMessage(error)),
      },
    );
  };

  const nameTaken =
    template === null &&
    (templates.data ?? []).some(
      (t) => t.name.trim().toLowerCase() === draft.name.trim().toLowerCase(),
    );

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-6"
      aria-label={template ? `Edit ${template.name}` : 'New pack template'}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h2 className="text-h2 wrap-anywhere">{template ? template.name : 'New template'}</h2>
        {template ? (
          <Toggle
            label={template.active ? 'On sale' : 'Off sale'}
            description="Members see and buy only active templates"
            checked={template.active}
            disabled={activate.isPending}
            onCheckedChange={(active) =>
              activate.mutate(
                { id: template.id, body: { active } },
                {
                  onSuccess: (saved) => {
                    toastSuccess(active ? `${saved.name} is on sale` : `${saved.name} is off sale`);
                    onSaved(saved);
                  },
                  onError: toastApiError,
                },
              )
            }
          />
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <div className="flex flex-col gap-1">
          <Input
            label="Name"
            value={draft.name}
            maxLength={100}
            onChange={(event) => edit({ name: event.target.value })}
            error={problems.get('name')}
          />
          {nameTaken && !problems.has('name') ? (
            <p className="text-small text-gold">Another template already has this name.</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <Input
            label="Price in coins"
            type="number"
            inputMode="numeric"
            min={0}
            value={draft.cost}
            onChange={(event) => edit({ cost: event.target.value })}
            error={problems.get('cost')}
          />
        </div>
      </div>

      <SetPicker
        setIds={draft.setIds}
        onChange={(setIds) => edit({ setIds })}
        problem={problems.get('sets')}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-3">
          <h3 className="text-h3">Slots and rarity weights</h3>
          <p className="text-small text-mut">
            Every card of a slot is drawn on its own: a rarity by weight, then a card of that rarity
            from the sets. A weight of 0 never draws.
          </p>
          {draft.slots.map((slot, i) => (
            <SlotEditor
              key={i}
              index={i}
              slot={slot}
              rarities={rarities}
              problems={problems}
              onChange={(next) => setSlot(i, next)}
              onRemove={
                draft.slots.length > 1
                  ? () => edit({ slots: draft.slots.filter((_, k) => k !== i) })
                  : null
              }
            />
          ))}
          <Problem message={problems.get('slots')} />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={Plus}
            className="self-start"
            disabled={draft.slots.length >= 10}
            onClick={() =>
              edit({ slots: [...draft.slots, { count: '1', rows: [{ rarity: '', weight: '1' }] }] })
            }
          >
            Add a slot
          </Button>
        </div>
        <section
          aria-labelledby="preview-heading"
          className="flex flex-col gap-3 xl:sticky xl:top-24 xl:self-start"
        >
          <h3 id="preview-heading" className="text-h3">
            Expected pull rates
          </h3>
          <OddsPreview slots={previewSlots(draft)} />
        </section>
      </div>

      {template === null ? (
        <Toggle
          label="Put it on sale when created"
          description="Off: only admins see it until you switch it on"
          checked={draft.active}
          onCheckedChange={(active) => edit({ active })}
        />
      ) : null}

      {serverError ? (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-control border border-red/30 bg-red-dim px-3 py-2 text-small text-red"
        >
          <CircleAlert aria-hidden className="size-4 shrink-0" />
          {serverError}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          icon={Save}
          loading={save.isPending}
          disabled={problems.size > 0 || !dirty}
          aria-describedby={first ? 'save-blocker' : undefined}
        >
          {template ? 'Save changes' : 'Create template'}
        </Button>
        {first ? (
          <p id="save-blocker" className="text-small text-mut">
            Can’t save yet — {first}
          </p>
        ) : !dirty && template ? (
          <p className="text-small text-mut">No changes to save.</p>
        ) : null}
      </div>
    </form>
  );
}
