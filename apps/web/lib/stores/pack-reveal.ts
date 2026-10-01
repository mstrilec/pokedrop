import { createStore } from 'zustand/vanilla';
import { createStoreContext } from './context';
import { SEALED, transition, type RevealEvent, type RevealState } from './reveal-machine';

export type PackRevealStore = RevealState & { send: (event: RevealEvent) => void };

export const [PackRevealProvider, usePackReveal] = createStoreContext('usePackReveal', () =>
  createStore<PackRevealStore>()((set) => ({
    ...SEALED,
    send: (event) => set((state) => transition(state, event)),
  })),
);
