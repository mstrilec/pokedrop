'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { SessionIdentity } from './identity';

const SessionContext = createContext<SessionIdentity | null>(null);

export function SessionProvider({
  identity,
  children,
}: {
  identity: SessionIdentity | null;
  children: ReactNode;
}) {
  return <SessionContext value={identity}>{children}</SessionContext>;
}

export function useSession(): SessionIdentity | null {
  return useContext(SessionContext);
}
