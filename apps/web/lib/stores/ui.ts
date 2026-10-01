import { createStore } from 'zustand/vanilla';
import { createStoreContext } from './context';

export interface UiStore {
  /** The open modal's id; one at a time. */
  modal: string | null;
  /** The sidebar drawer on narrow screens; wide screens always show the sidebar. */
  navOpen: boolean;
  filterPanelOpen: boolean;
  openModal: (id: string) => void;
  closeModal: () => void;
  setNavOpen: (open: boolean) => void;
  setFilterPanelOpen: (open: boolean) => void;
}

export const [UiProvider, useUi] = createStoreContext('useUi', () =>
  createStore<UiStore>()((set) => ({
    modal: null,
    navOpen: false,
    filterPanelOpen: false,
    openModal: (id) => set({ modal: id }),
    closeModal: () => set({ modal: null }),
    setNavOpen: (open) => set({ navOpen: open }),
    setFilterPanelOpen: (open) => set({ filterPanelOpen: open }),
  })),
);
