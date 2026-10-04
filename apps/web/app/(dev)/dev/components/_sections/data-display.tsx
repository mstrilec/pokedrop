'use client';

import type { NotificationView } from '@pokedrop/shared';
import { createColumnHelper } from '@tanstack/react-table';
import { Coins, Layers, PackageOpen, TrendingUp, Users } from 'lucide-react';
import { useState } from 'react';
import { NotificationRow } from '@/components/notifications/notification-row';
import { PackTemplateCard } from '@/components/packs/pack-template-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { StatCard } from '@/components/ui/stat-card';
import { formatCoins } from '@/lib/format';
import { Group, Row, Specimen } from './frame';

type Member = {
  id: string;
  name: string;
  role: 'Admin' | 'Member';
  coins: number;
  status: 'Active' | 'Suspended';
};

const MEMBERS: Member[] = [
  { id: 'u1', name: 'Misty', role: 'Member', coins: 1250, status: 'Active' },
  { id: 'u2', name: 'Professor Oak', role: 'Admin', coins: 10000, status: 'Active' },
  { id: 'u3', name: 'Brock', role: 'Member', coins: 40, status: 'Suspended' },
  { id: 'u4', name: 'Ash', role: 'Member', coins: 830, status: 'Active' },
];

const column = createColumnHelper<Member>();
const COLUMNS = [
  column.accessor('name', { header: 'User', meta: { width: '1.6fr' } }),
  column.accessor('role', {
    header: 'Role',
    cell: (c) =>
      c.getValue() === 'Admin' ? (
        <Badge tone="danger" label="Admin" bordered dot={false} />
      ) : (
        'Member'
      ),
  }),
  column.accessor('coins', {
    header: 'Coins',
    meta: { numeric: true },
    cell: (c) => <span className="text-gold">{formatCoins(c.getValue())}</span>,
  }),
  column.accessor('status', {
    header: 'Status',
    enableSorting: false,
    cell: (c) => (
      <Badge tone={c.getValue() === 'Active' ? 'success' : 'danger'} label={c.getValue()} />
    ),
  }),
];

const NOW = new Date('2026-10-04T12:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const party = (displayName: string): NotificationView['counterparty'] => ({
  id: displayName as NonNullable<NotificationView['counterparty']>['id'],
  displayName,
  avatarUrl: null,
});
const note = (
  id: string,
  type: string,
  minutes: number,
  extra: Partial<NotificationView> = {},
): NotificationView => ({
  id: id as NotificationView['id'],
  type,
  payload: { tradeId: 'trade-4830' },
  counterparty: party('MistyW'),
  readAt: null,
  createdAt: minutesAgo(minutes),
  ...extra,
});

const NOTIFICATIONS: NotificationView[] = [
  note('n1', 'trade.proposed', 12),
  note('n2', 'trade.countered', 60, { counterparty: party('BrockH') }),
  note('n3', 'trade.accepted', 60 * 26, { readAt: NOW }),
  note('n4', 'trade.declined', 60 * 30, { readAt: NOW }),
  note('n5', 'trade.cancelled', 60 * 50, { readAt: NOW }),
  note('n6', 'trade.voided', 60 * 72, { readAt: NOW }),
  note('n7', 'trade.expired', 60 * 24 * 8, { readAt: NOW }),
  note('n8', 'currency.granted', 3, { payload: { amount: 500 }, counterparty: null }),
  note('n9', 'currency.granted', 60 * 24 * 40, {
    payload: { amount: -200 },
    counterparty: null,
    readAt: NOW,
  }),
  note('n10', 'system.unknown', 60 * 24 * 400, { counterparty: null, readAt: NOW }),
];

export function DataDisplaySection() {
  const [rows, setRows] = useState<'many' | 'one' | 'none' | 'loading'>('many');
  const [opened, setOpened] = useState<string | null>(null);
  const data = rows === 'many' ? MEMBERS : rows === 'one' ? MEMBERS.slice(0, 1) : [];

  return (
    <Group id="data-display" title="Data display">
      <Specimen name="StatCard">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Collection value"
            value="$2,480"
            icon={TrendingUp}
            tone="success"
            trend="+3.2% (7d)"
          />
          <StatCard
            label="Coins"
            value="1,250"
            icon={Coins}
            tone="warning"
            trend="−150 today"
            trendTone="down"
          />
          <StatCard
            label="Unique cards"
            value="342"
            icon={Layers}
            trend="No change"
            trendTone="flat"
          />
          <StatCard label="Packs opened" value="—" icon={PackageOpen} trend="+2" loading />
        </div>
        <Row label="Compact (inventory) and admin metric">
          <StatCard label="Sets complete" value="2 of 9" compact className="w-48" />
          <StatCard
            label="Daily active"
            value="1,204"
            icon={Users}
            tone="accent"
            compact
            className="w-56"
          />
        </Row>
      </Specimen>

      <Specimen name="DataTable (TanStack Table; click a sortable header)">
        <Row label="Rows">
          {(['many', 'one', 'none', 'loading'] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={rows === value ? 'primary' : 'secondary'}
              onClick={() => setRows(value)}
            >
              {value}
            </Button>
          ))}
          <span className="text-small text-faint">
            {opened ? `Opened ${opened}` : 'Click a row'}
          </span>
        </Row>
        <DataTable
          label="Members"
          columns={COLUMNS}
          data={data}
          getRowId={(m) => m.id}
          loading={rows === 'loading'}
          onRowClick={(m) => setOpened(m.name)}
          empty="No members match these filters."
        />
      </Specimen>

      <Specimen name="PackTemplateCard (balance 120 coins)">
        <div className="grid gap-4 sm:grid-cols-[repeat(auto-fill,minmax(230px,1fr))]">
          <PackTemplateCard
            template={{
              name: 'Base Set Booster',
              cost: 100,
              cardCount: 10,
              guarantee: '1 Rare or better',
            }}
            type="Fire"
            balance={120}
            onOpen={() => setOpened('Base Set Booster')}
          />
          <PackTemplateCard
            template={{
              name: 'Astral Eclipse',
              cost: 150,
              cardCount: 10,
              guarantee: '1 Ultra Rare guaranteed',
            }}
            type="Psychic"
            tag="Latest"
            balance={120}
            onOpen={() => setOpened('Astral Eclipse')}
          />
          <PackTemplateCard
            template={{
              name: 'Premium Collection',
              cost: 250_000,
              cardCount: 20,
              guarantee: '2 Secret Rares',
            }}
            type="Dragon"
            tag="Premium"
            balance={120}
            onOpen={() => setOpened('Premium Collection')}
          />
        </div>
      </Specimen>

      <Specimen name="NotificationRow (every kind; times against a fixed now)">
        <div className="flex max-w-2xl flex-col gap-2.5">
          {NOTIFICATIONS.map((n) => (
            <NotificationRow
              key={n.id}
              notification={n}
              now={NOW}
              href="/dev/components#data-display"
            />
          ))}
        </div>
      </Specimen>
    </Group>
  );
}
