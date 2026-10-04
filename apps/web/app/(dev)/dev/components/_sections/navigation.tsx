'use client';

import { TRADE_TABS } from '@pokedrop/shared';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Tabs, TabsPanel, useUrlTab } from '@/components/ui/tabs';
import { Group, Row, Specimen } from './frame';

const LABELS = { all: 'All', incoming: 'Incoming', sent: 'Sent', completed: 'Completed' } as const;
const COUNTS = { all: 5, incoming: 2, sent: 2, completed: 1 } as const;

export function NavigationSection() {
  const [tab, setTab] = useUrlTab('tab', TRADE_TABS);

  return (
    <Group id="navigation" title="Navigation">
      <Specimen name="Tabs (URL-synced: ?tab=)">
        <Tabs
          label="Trades"
          tabs={TRADE_TABS.map((value) => ({ value, label: LABELS[value], count: COUNTS[value] }))}
          value={tab}
          onValueChange={setTab}
        >
          {TRADE_TABS.map((value) => (
            <TabsPanel key={value} value={value} className="border border-bd bg-bg p-4">
              <p className="text-small text-mut">
                {LABELS[value]} trades would list here ({COUNTS[value]}).
              </p>
            </TabsPanel>
          ))}
        </Tabs>
      </Specimen>
      <Specimen name="Breadcrumbs">
        <Row label="Two levels">
          <Breadcrumbs trail={[{ label: 'Trades', href: '/trades' }, { label: 'Trade #4830' }]} />
        </Row>
        <Row label="Three levels; on a narrow screen the middle collapses to …">
          <Breadcrumbs
            trail={[
              { label: 'Collection', href: '/inventory' },
              { label: 'Astral Eclipse', href: '/sets' },
              { label: 'Charizard ex' },
            ]}
          />
        </Row>
        <Row label="Long labels truncate, with the full text in a tooltip">
          <Breadcrumbs
            trail={[
              { label: 'Collection', href: '/inventory' },
              { label: 'Scarlet & Violet — Paradox Rift Elite Trainer Box', href: '/sets' },
              { label: 'Iron Valiant ex Special Illustration Rare Full Art Alternate' },
            ]}
          />
        </Row>
      </Specimen>
    </Group>
  );
}
