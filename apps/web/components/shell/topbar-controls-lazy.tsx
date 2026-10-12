'use client';

import dynamic from 'next/dynamic';

// The public layout imports the signed-in shell for guests too; a direct import
// would put the dropdown, queries and API client (with zod) in every guest page's first load.
export const MenuButton = dynamic(() => import('./topbar-controls').then((m) => m.MenuButton));
export const BalancePill = dynamic(() => import('./topbar-controls').then((m) => m.BalancePill));
export const NotificationBell = dynamic(() =>
  import('./topbar-controls').then((m) => m.NotificationBell),
);
export const AvatarMenu = dynamic(() => import('./topbar-controls').then((m) => m.AvatarMenu));
