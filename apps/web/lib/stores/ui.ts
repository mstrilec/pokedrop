import { createStore } from 'zustand/vanilla';
import { createStoreContext } from './context';

export interface UiStore {
  modal: string | null;
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
