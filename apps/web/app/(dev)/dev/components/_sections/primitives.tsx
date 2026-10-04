'use client';

import { RarityTierSchema, TradeStatusSchema } from '@pokedrop/shared';
import { Bell, Check, EllipsisVertical, PackageOpen, Shield, TriangleAlert, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Badge, RarityBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { TRADE_STATUS_STYLES } from '@/lib/design/status';
import { Group, Row, Specimen } from './frame';

const VARIANTS = ['primary', 'secondary', 'ghost', 'confirm', 'destructive', 'economy'] as const;
const SIZES = ['sm', 'md', 'lg'] as const;

export function PrimitivesSection() {
  const [busy, setBusy] = useState(false);
  const [clicks, setClicks] = useState(0);
  const [chips, setChips] = useState(['Base Set', 'Rare', 'Fire']);

  return (
    <Group id="primitives" title="Primitives">
      <Specimen name="Button">
        <Row label="Variants">
          {VARIANTS.map((variant) => (
            <Button key={variant} variant={variant} className="capitalize">
              {variant}
            </Button>
          ))}
        </Row>
        <Row label="Sizes, with icon">
          {SIZES.map((size) => (
            <Button key={size} size={size} icon={PackageOpen}>
              Open pack {size}
            </Button>
          ))}
        </Row>
        <Row label="Disabled">
          {VARIANTS.map((variant) => (
            <Button key={variant} variant={variant} disabled className="capitalize">
              {variant}
            </Button>
          ))}
        </Row>
        <Row label={`Loading: click to start, then try clicking again (clicks: ${clicks})`}>
          <Button
            loading={busy}
            onClick={() => {
              setClicks((n) => n + 1);
              setBusy(true);
              setTimeout(() => setBusy(false), 3000);
            }}
          >
            Confirm trade
          </Button>
          <Button variant="economy" loading>
            Spending 150 coins
          </Button>
        </Row>
        <Row label="As a link">
          <Button asChild variant="secondary">
            <Link href="/dev/components#primitives">Back to top</Link>
          </Button>
        </Row>
      </Specimen>

      <Specimen name="IconButton">
        <Row label="Surface · ghost · disabled">
          <IconButton icon={Bell} label="Notifications" />
          <IconButton icon={EllipsisVertical} label="More actions" variant="ghost" />
          <IconButton icon={X} label="Close" variant="ghost" disabled />
        </Row>
        <Row label="Badge: dot · count drawn as dot · count shown · zero">
          <IconButton icon={Bell} label="Notifications" badge />
          <IconButton icon={Bell} label="Notifications" badge={3} />
          <IconButton icon={Bell} label="Notifications" badge={12} showCount />
          <IconButton icon={Bell} label="Notifications" badge={0} showCount />
        </Row>
      </Specimen>

      <Specimen name="Badge / Chip">
        <Row label="Rarity">
          {RarityTierSchema.options.map((tier) => (
            <RarityBadge key={tier} rarity={tier} />
          ))}
        </Row>
        <Row label="Trade status">
          {TradeStatusSchema.options.map((status) => (
            <Badge key={status} {...TRADE_STATUS_STYLES[status]} dot={false} />
          ))}
        </Row>
        <Row label="Deck legality · role">
          <Badge tone="success" icon={Check} label="Legal" />
          <Badge tone="warning" icon={TriangleAlert} label="Issues" />
          <Badge tone="danger" icon={Shield} label="Admin" bordered />
        </Row>
        <Row label="Utility tags">
          <Badge shape="tag" tone="primary" label="IN" />
          <Badge shape="tag" label="OUT" />
          <Badge shape="tag" tone="warning" label="Locked" />
        </Row>
        <Row label="Dismissible">
          {chips.map((chip) => (
            <Badge
              key={chip}
              tone="primary"
              label={chip}
              dot={false}
              bordered
              onDismiss={() => setChips((all) => all.filter((c) => c !== chip))}
            />
          ))}
          {chips.length === 0 ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setChips(['Base Set', 'Rare', 'Fire'])}
            >
              Reset chips
            </Button>
          ) : null}
        </Row>
      </Specimen>

      <Specimen name="Avatar">
        <Row label="Initial at 28 · 34 · 44 · 88">
          {[28, 34, 44, 88].map((size) => (
            <Avatar key={size} name="Misty Waterflower" size={size} />
          ))}
        </Row>
        <Row label="Image · broken image falls back · ring">
          <Avatar
            name="Base Set Charizard"
            src="https://images.pokemontcg.io/base1/4.png"
            size={44}
          />
          <Avatar name="Brock" src="https://avatar.invalid/missing.png" size={44} />
          <Avatar name="Ash" size={44} ring />
        </Row>
      </Specimen>
    </Group>
  );
}
