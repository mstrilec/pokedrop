'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CardSearchQuerySchema, CardSortSchema } from '@pokedrop/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownWideNarrow, Droplet, Grid3x3, Star } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { type FilterDef, FilterBar } from '@/components/ui/filter-bar';
import { applyApiError, Form, FormError, FormField, FormToggle } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { Toggle } from '@/components/ui/toggle';
import { api } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/core';
import { searchCards } from '@/lib/api/endpoints/catalog';
import { useCatalogFacets } from '@/lib/query/catalog';
import { keys } from '@/lib/query/keys';
import { useUrlState } from '@/lib/url-state';
import { Group, Row, Specimen } from './frame';

const SignInDemoSchema = z.object({
  email: z.email('Enter an email address'),
  password: z.string().min(8, 'At least 8 characters'),
  rememberMe: z.boolean(),
});
type SignInDemo = z.infer<typeof SignInDemoSchema>;

const CatalogFilterSchema = CardSearchQuerySchema.pick({
  q: true,
  set: true,
  rarity: true,
  type: true,
  supertype: true,
  sort: true,
});

const SORT_LABELS: Record<z.output<typeof CardSortSchema>, string> = {
  name_asc: 'Name A–Z',
  name_desc: 'Name Z–A',
};

function SignInDemoForm() {
  const form = useForm<SignInDemo>({
    resolver: zodResolver(SignInDemoSchema),
    mode: 'onTouched',
    defaultValues: { email: '', password: '', rememberMe: true },
  });

  async function submit(values: SignInDemo) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    const error =
      values.email === 'unverified@pokedrop.test'
        ? new ApiError({
            kind: 'api',
            statusCode: 403,
            code: 'EMAIL_NOT_VERIFIED',
            message: 'Verify your email first. We sent you a new link.',
          })
        : new ApiError({
            kind: 'auth',
            statusCode: 401,
            code: 'INVALID_EMAIL_OR_PASSWORD',
            message: 'Invalid email or password',
          });
    applyApiError(form, error, { EMAIL_NOT_VERIFIED: 'email' });
  }

  return (
    <Form form={form} onSubmit={submit} className="max-w-sm">
      <FormField<SignInDemo> name="email" label="Email" type="email" autoComplete="email" />
      <FormField<SignInDemo>
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        help="The one you chose when you signed up."
      />
      <FormToggle<SignInDemo> name="rememberMe" label="Remember me" />
      <FormError />
      <Button type="submit" loading={form.formState.isSubmitting}>
        Sign in
      </Button>
    </Form>
  );
}

function CatalogFilterDemo() {
  const [query, setQuery] = useUrlState(CatalogFilterSchema);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const facets = useCatalogFacets();
  const cards = useQuery({
    queryKey: keys.catalog.search({ ...query, pageSize: 5 }),
    queryFn: () => api.call(searchCards({ ...query, pageSize: 5 })),
  });

  const fromFacets = (list: 'sets' | 'rarities' | 'types') => facets.data?.[list];
  const filters: FilterDef[] = [
    {
      key: 'set',
      label: 'Set',
      icon: Grid3x3,
      kind: 'select',
      options: fromFacets('sets'),
      error: facets.isError,
    },
    {
      key: 'rarity',
      label: 'Rarity',
      icon: Star,
      kind: 'select',
      options: fromFacets('rarities'),
      error: facets.isError,
    },
    {
      key: 'type',
      label: 'Type',
      icon: Droplet,
      kind: 'select',
      options: fromFacets('types'),
      error: facets.isError,
    },
    {
      key: 'sort',
      label: 'Sort',
      icon: ArrowDownWideNarrow,
      kind: 'sort',
      options: CardSortSchema.unwrap().options.map((value) => ({
        value,
        label: SORT_LABELS[value],
      })),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        search={
          <SearchInput
            value={query.q ?? ''}
            onSearch={(q) => setQuery({ q: q || undefined }, { history: 'replace' })}
            loading={cards.isFetching}
            resultCount={cards.data?.total}
            placeholder="Search the catalog…"
          />
        }
        filters={filters}
        value={query}
        onChange={setQuery}
        view={view}
        onViewChange={setView}
      />
      <p className="font-mono text-small text-faint">
        {cards.isError
          ? 'Search failed'
          : cards.data
            ? [`${cards.data.total} cards`, ...cards.data.items.map((c) => c.name)].join(' · ')
            : 'Loading…'}
      </p>
    </div>
  );
}

export function InputsSection() {
  const [publicProfile, setPublicProfile] = useState(true);
  const [search, setSearch] = useState('');

  return (
    <Group id="inputs" title="Inputs & forms">
      <Specimen name="Input">
        <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <Input label="Display name" placeholder="Ash Ketchum" />
          <Input label="Display name" help="Shown on your public profile." defaultValue="Misty" />
          <Input
            label="Email"
            type="email"
            defaultValue="not-an-email"
            error="Enter an email address"
          />
          <Input label="Password" type="password" defaultValue="pikachu-123" />
          <Input label="Coins" type="number" mono defaultValue="1250" />
          <Input label="Email" disabled defaultValue="locked@pokedrop.test" />
        </div>
      </Specimen>
      <Specimen name="Toggle">
        <div className="flex max-w-md flex-col gap-4">
          <Toggle
            label="Public profile"
            description="Anyone with the link can see your showcase."
            checked={publicProfile}
            onCheckedChange={setPublicProfile}
          />
          <Toggle
            label="Show collection value"
            checked={false}
            onCheckedChange={() => {}}
            disabled
          />
        </div>
      </Specimen>
      <Specimen name="Form (React Hook Form + Zod)">
        <p className="text-small text-faint">
          Submit empty to see Zod errors. unverified@pokedrop.test fails on the field; any other
          address fails for the whole form.
        </p>
        <SignInDemoForm />
      </Specimen>
      <Specimen name="SearchInput">
        <Row label={`Debounced value: "${search}"`}>
          <SearchInput
            value={search}
            onSearch={setSearch}
            resultCount={search ? 3 : undefined}
            className="w-80"
          />
        </Row>
      </Specimen>
      <Specimen name="FilterBar (live: URL state, facets and search against the API)">
        <CatalogFilterDemo />
      </Specimen>
    </Group>
  );
}
