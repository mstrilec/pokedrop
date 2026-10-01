'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { useStore, type StoreApi } from 'zustand';

// One store per provider, never a module singleton: on the server a module is
// shared by every request, so a singleton would leak one visitor's state into
// another's render.
export function createStoreContext<State, Props extends object = object>(
  name: string,
  create: (props: Props) => StoreApi<State>,
) {
  const Context = createContext<StoreApi<State> | null>(null);

  function Provider({ children, ...props }: Props & { children: ReactNode }) {
    const [store] = useState(() => create(props as unknown as Props));
    return <Context value={store}>{children}</Context>;
  }

  function useSelector<T>(selector: (state: State) => T): T {
    const store = useContext(Context);
    if (!store) throw new Error(`${name} is used outside its provider`);
    return useStore(store, selector);
  }

  return [Provider, useSelector] as const;
}
