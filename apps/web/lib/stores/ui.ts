import { createStore } from 'zustand/vanilla';
import { createStoreContext } from './context';

export interface UiStore {
  /** The open modal's id; one at a time. */
  modal: string | null;
  sidebarCollapsed: boolean;
  filterPanelOpen: boolean;
  openModal: (id: string) => void;
  closeModal: () => void;
  toggleSidebar: () => void;
  setFilterPanelOpen: (open: boolean) => void;
}

export const [UiProvider, useUi] = createStoreContext('useUi', () =>
  createStore<UiStore>()((set) => ({
    modal: null,
    sidebarCollapsed: false,
    filterPanelOpen: false,
    openModal: (id) => set({ modal: id }),
    closeModal: () => set({ modal: null }),
    toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    setFilterPanelOpen: (open) => set({ filterPanelOpen: open }),
  })),
);
