'use client';

import { LogOut, Monitor, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ListError } from '@/components/list-states';
import type { SessionRow } from '@/lib/api/endpoints/auth';
import { dateTime, timeAgo } from '@/lib/format';
import { useRevokeOtherSessions, useSessions } from '@/lib/query/account';
import { SettingsSection } from './settings-section';

const BROWSERS: [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
  [/curl\//, 'curl'],
];
const SYSTEMS: [RegExp, string][] = [
  [/Android/, 'Android'],
  [/iPhone|iPad/, 'iOS'],
  [/Windows/, 'Windows'],
  [/Mac OS X/, 'macOS'],
  [/Linux/, 'Linux'],
];

/** `Chrome on Windows` — enough to recognise a device, never more than the agent says. */
function device(session: SessionRow): { name: string; mobile: boolean } {
  const agent = session.userAgent ?? '';
  const browser = BROWSERS.find(([pattern]) => pattern.test(agent))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(agent))?.[1];
  const name = [browser, system].filter(Boolean).join(' on ') || 'Unknown device';
  return { name, mobile: /Mobile|Android|iPhone/.test(agent) };
}

const plural = (n: number) => `${n} other ${n === 1 ? 'session' : 'sessions'}`;

export function SessionSettings() {
  const sessions = useSessions();
  const revoke = useRevokeOtherSessions();
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const rows = sessions.data
    ? [...sessions.data.sessions].sort(
        (a, b) =>
          Number(b.id === sessions.data.currentId) - Number(a.id === sessions.data.currentId) ||
          b.updatedAt.getTime() - a.updatedAt.getTime(),
      )
    : [];
  const others = rows.filter((row) => row.id !== sessions.data?.currentId).length;

  const confirm = () =>
    revoke.mutate(undefined, {
      onSuccess: () => {
        setDone(`Signed out ${plural(others)}. This device is still signed in.`);
        setAsking(false);
      },
    });

  return (
    <SettingsSection
      id="sessions"
      title="Sessions"
      description="Every browser and device signed in to your account. A session ends on its own after a week without use."
    >
      <div className="flex flex-col gap-4">
        {sessions.isPending ? (
          <Skeleton shape="block" height="6rem" />
        ) : sessions.isError ? (
          <ListError error={sessions.error} onRetry={() => void sessions.refetch()} />
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => {
              const { name, mobile } = device(row);
              const Icon = mobile ? Smartphone : Monitor;
              const current = row.id === sessions.data.currentId;
              return (
                <li
                  key={row.id}
                  className="flex items-center gap-3 rounded-control border border-bd bg-bg px-3 py-2.5"
                >
                  <Icon aria-hidden className="size-5 shrink-0 text-mut" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-small font-medium text-tx">{name}</span>
                    <span className="truncate text-[11.5px] text-faint">
                      {row.ipAddress ? `${row.ipAddress} · ` : ''}signed in{' '}
                      <time dateTime={row.createdAt.toISOString()} title={dateTime(row.createdAt)}>
                        {timeAgo(row.createdAt)}
                      </time>
                      {' · '}last active {timeAgo(row.updatedAt)}
                    </span>
                  </span>
                  {current ? <Badge label="This device" tone="success" /> : null}
                </li>
              );
            })}
          </ul>
        )}
        {done ? (
          <p role="status" className="text-small text-grn">
            {done}
          </p>
        ) : null}
        <Button
          variant="destructive"
          icon={LogOut}
          className="self-start"
          disabled={others === 0}
          onClick={() => setAsking(true)}
        >
          Sign out other devices
        </Button>
        {others === 0 && sessions.data ? (
          <p className="text-small text-mut">This is the only device signed in.</p>
        ) : null}
      </div>
      <Dialog
        open={asking}
        onOpenChange={(open) => {
          if (!open) setAsking(false);
        }}
        tone="danger"
        icon={LogOut}
        title={`Sign out ${plural(others)}?`}
        description="Every other browser and device signed in to your account is signed out at once and has to sign in again. This one stays signed in."
        confirmLabel="Sign them out"
        confirming={revoke.isPending}
        onConfirm={confirm}
      />
    </SettingsSection>
  );
}
