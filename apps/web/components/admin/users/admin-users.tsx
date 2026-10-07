'use client';

import type { AdminUserRow } from '@pokedrop/shared';
import { createColumnHelper } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, MoreHorizontal, Users } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { ListError } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/search-input';
import { formatCoins } from '@/lib/format';
import { type UserAction, useAdminUserAction, useAdminUsers } from '@/lib/query/admin';
import { useSession } from '@/lib/session/context';
import { toastSuccess } from '@/lib/toast';
import { type Asking, UserActionDialog } from './user-action-dialog';

const PAGE_SIZE = 25;
type RoleFilter = 'all' | 'MEMBER' | 'ADMIN';
type StatusFilter = 'all' | 'active' | 'suspended';

const done = (action: UserAction): string => {
  const name = action.user.displayName || action.user.email;
  switch (action.kind) {
    case 'grant':
      return action.body.amount > 0
        ? `Granted ${formatCoins(action.body.amount)} coins to ${name}`
        : `Took ${formatCoins(-action.body.amount)} coins from ${name}`;
    case 'role':
      return action.role === 'ADMIN' ? `${name} is an admin` : `${name} is a member`;
    case 'suspend':
      return `${name} is suspended and signed out everywhere`;
    case 'unsuspend':
      return `${name} can sign in again`;
  }
};

const column = createColumnHelper<AdminUserRow>();

export function AdminUsers() {
  const session = useSession();
  const params = useSearchParams();
  // `?q=` from the audit log's and the trade page's links.
  const [q, setQ] = useState(() => params.get('q')?.trim() ?? '');
  const [role, setRole] = useState<RoleFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [asking, setAsking] = useState<Asking | null>(null);
  const users = useAdminUsers({
    q: q || undefined,
    role: role === 'all' ? undefined : role,
    suspended: status === 'all' ? undefined : status === 'suspended' ? 'true' : 'false',
    page,
    pageSize: PAGE_SIZE,
  });
  const act = useAdminUserAction();
  const data = users.data;

  const confirm = (action: UserAction) => {
    // Optimistic: the row changes now and the dialog closes; a refusal puts it back with a toast.
    setAsking(null);
    act.mutate(action, { onSuccess: () => toastSuccess(done(action)) });
  };

  const columns = [
    column.display({
      id: 'user',
      header: 'User',
      meta: { width: 'minmax(14rem, 2fr)' },
      cell: ({ row: { original: u } }) => (
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={u.displayName || u.email} src={u.avatarUrl} size={32} decorative />
          <span className="flex min-w-0 flex-col">
            <Link
              href={`/profile/${u.id}`}
              className="focus-ring truncate rounded-tag font-medium text-tx hover:underline"
            >
              {u.displayName || '(no name)'}
              {u.id === session?.id ? <span className="text-mut"> · you</span> : null}
            </Link>
            <span className="truncate text-[11.5px] text-mut">{u.email}</span>
          </span>
        </span>
      ),
    }),
    column.accessor('role', {
      header: 'Role',
      meta: { width: '6.5rem' },
      cell: (info) => (
        <Badge
          label={info.getValue() === 'ADMIN' ? 'Admin' : 'Member'}
          tone={info.getValue() === 'ADMIN' ? 'accent' : 'neutral'}
          shape="tag"
        />
      ),
    }),
    column.accessor('currency', {
      header: 'Balance',
      meta: { width: '7rem', numeric: true },
      cell: (info) => <span className="font-mono">{formatCoins(info.getValue())}</span>,
    }),
    column.display({
      id: 'status',
      header: 'Status',
      meta: { width: 'minmax(8rem, 10rem)' },
      cell: ({ row: { original: u } }) =>
        u.suspendedAt ? (
          <span className="flex flex-col">
            <Badge label="Suspended" tone="danger" shape="tag" className="self-start" />
            <span className="text-[11px] text-faint">
              since {u.suspendedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          </span>
        ) : (
          <span className="flex flex-col">
            <Badge label="Active" tone="success" shape="tag" className="self-start" />
            {u.emailVerified ? null : (
              <span className="text-[11px] text-gold">email not verified</span>
            )}
          </span>
        ),
    }),
    column.accessor('createdAt', {
      header: 'Joined',
      meta: { width: '7rem' },
      cell: (info) =>
        info
          .getValue()
          .toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
    }),
    column.display({
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      meta: { width: '3.5rem' },
      cell: ({ row: { original: u } }) => {
        const self = u.id === session?.id;
        const name = u.displayName || u.email;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Actions for ${name}`}
              className="focus-ring flex size-8 cursor-pointer items-center justify-center rounded-control text-mut hover:bg-surface-2 hover:text-tx"
            >
              <MoreHorizontal aria-hidden className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => setAsking({ kind: 'grant', user: u })}>
                Grant or take coins…
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={self}
                onSelect={() => setAsking({ kind: 'role', user: u })}
              >
                {u.role === 'ADMIN' ? 'Make member…' : 'Make admin…'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {u.suspendedAt ? (
                <DropdownMenuItem onSelect={() => setAsking({ kind: 'unsuspend', user: u })}>
                  Unsuspend…
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  variant="destructive"
                  disabled={self}
                  onSelect={() => setAsking({ kind: 'suspend', user: u })}
                >
                  Suspend…
                </DropdownMenuItem>
              )}
              {self ? (
                <p className="px-2 py-1.5 text-[11px] text-faint">
                  Your own role and access are another admin’s call.
                </p>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    }),
  ];

  const select = 'focus-ring h-10 rounded-control border border-bd-2 bg-bg px-3 text-small text-tx';
  const totalPages = data?.totalPages ?? 0;

  return (
    <>
      <PageHeader
        title="Users"
        description="Every account, newest first. Each action asks first, shows at once, and is undone if the server refuses it."
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <SearchInput
          value={q}
          label="Search users"
          placeholder="Email or display name"
          onSearch={(value) => {
            setQ(value.trim());
            setPage(1);
          }}
          loading={users.isFetching}
          className="min-w-60 flex-1"
        />
        <label className="flex flex-col gap-1.5 text-small text-mut">
          Role
          <select
            className={select}
            value={role}
            onChange={(event) => {
              setRole(event.target.value as RoleFilter);
              setPage(1);
            }}
          >
            <option value="all">All roles</option>
            <option value="MEMBER">Members</option>
            <option value="ADMIN">Admins</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-small text-mut">
          Status
          <select
            className={select}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as StatusFilter);
              setPage(1);
            }}
          >
            <option value="all">Any status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </label>
      </div>
      {users.isError ? (
        <ListError error={users.error} onRetry={() => void users.refetch()} />
      ) : (
        <>
          <DataTable
            label="Users, newest first"
            columns={columns}
            data={data?.items ?? []}
            getRowId={(u) => u.id}
            loading={users.isPending}
            empty={
              <EmptyState
                icon={Users}
                tone="neutral"
                title="No users match"
                body="Try another part of the name or email, or clear a filter."
                className="border-0"
              />
            }
          />
          {data && data.total > 0 ? (
            <nav
              aria-label="Pages"
              className="mt-4 flex flex-wrap items-center justify-between gap-3 text-small text-mut"
            >
              <span>
                Page {data.page} of {totalPages} · {data.total.toLocaleString('en-US')}{' '}
                {data.total === 1 ? 'user' : 'users'}
              </span>
              <span className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={ChevronLeft}
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                  <ChevronRight aria-hidden className="size-4" />
                </Button>
              </span>
            </nav>
          ) : null}
        </>
      )}
      {asking ? (
        <UserActionDialog
          key={`${asking.kind}-${asking.user.id}`}
          asking={asking}
          onClose={() => setAsking(null)}
          onConfirm={confirm}
        />
      ) : null}
    </>
  );
}
