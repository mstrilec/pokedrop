import {
  ArrowLeftRight,
  Bell,
  Flag,
  Gauge,
  Grid3x3,
  Layers,
  LayoutDashboard,
  Library,
  type LucideProps,
  Package,
  PackageOpen,
  RefreshCw,
  ScrollText,
  Settings,
  Swords,
  Users,
  Wallet,
} from 'lucide-react';
import type { IconName } from '@/lib/nav';

const ICONS = {
  'layout-dashboard': LayoutDashboard,
  'package-open': PackageOpen,
  layers: Layers,
  library: Library,
  'grid-3x3': Grid3x3,
  swords: Swords,
  'arrow-left-right': ArrowLeftRight,
  bell: Bell,
  wallet: Wallet,
  settings: Settings,
  gauge: Gauge,
  package: Package,
  'refresh-cw': RefreshCw,
  users: Users,
  flag: Flag,
  'scroll-text': ScrollText,
} satisfies Record<IconName, React.ComponentType<LucideProps>>;

export function NavIcon({ name, ...props }: { name: IconName } & LucideProps) {
  const Icon = ICONS[name];
  return <Icon aria-hidden {...props} />;
}
