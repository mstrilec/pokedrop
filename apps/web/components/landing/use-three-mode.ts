'use client';

import { useSyncExternalStore } from 'react';

export type ThreeMode = 'poster' | 'full';

type CapableNavigator = Navigator & {
  connection?: { saveData?: boolean };
  deviceMemory?: number;
};

function webgl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

let decided: ThreeMode | null = null;

// A desktop-sized viewport with a mouse, motion allowed, WebGL, no data saver and more than
// four cores and 4 GB where the browser says. Lighthouse's mobile run emulates a
// coarse pointer, so it never loads three.js.
function decide(): ThreeMode {
  if (decided) return decided;
  const nav = navigator as CapableNavigator;
  const capable =
    matchMedia('(pointer: fine) and (min-width: 1024px) and (min-height: 640px)').matches &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches &&
    nav.connection?.saveData !== true &&
    (nav.hardwareConcurrency ?? 8) > 4 &&
    (nav.deviceMemory ?? 8) > 4 &&
    webgl();
  decided = capable ? 'full' : 'poster';
  return decided;
}

const subscribe = () => () => {};

/** `poster` on the server and during hydration, so both render the same markup. */
export function useThreeMode(): ThreeMode {
  return useSyncExternalStore(subscribe, decide, () => 'poster');
}
