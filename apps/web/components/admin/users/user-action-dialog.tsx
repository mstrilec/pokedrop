'use client';

import { type AdminUserRow, GrantCurrencySchema, SuspendUserSchema } from '@pokedrop/shared';
import { ArrowRight, Ban, Coins, ShieldCheck, ShieldOff, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatCoins } from '@/lib/format';
import type { UserAction } from '@/lib/query/admin';
import { cn } from '@/lib/utils';

export type Asking = { kind: 'grant' | 'role' | 'suspend' | 'unsuspend'; user: AdminUserRow };

const MAX_GRANT = 1_000_000;

/**
 * Every action on an account asks first. Mounted per question (keyed by the caller), so a grant
 * gets one `grantId` for the dialog's life: a confirm that is retried is the same grant.
 */
export function UserActionDialog({
  asking,
  onClose,
  onConfirm,
}: {
  asking: Asking;
  onClose: () => void;
  onConfirm: (action: UserAction) => void;
}) {
  const { user } = asking;
  const [grantId] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const name = user.displayName || user.email;

  if (asking.kind === 'grant') {
    const after = user.currency + amount;
    const parsed = GrantCurrencySchema.safeParse({ grantId, amount, reason });
    const problem =
      amount === 0
        ? 'Enter an amount: positive grants, negative takes coins back'
        : after < 0
          ? `${name} has only ${formatCoins(user.currency)} coins`
          : !parsed.success
            ? 'Say why — the reason goes into the audit log'
            : null;
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        icon={Coins}
        title={`Adjust ${name}’s coins`}
        description="Written to the ledger and the audit log; the member is notified."
        confirmLabel={
          amount < 0 ? `Take ${formatCoins(-amount)} coins` : `Grant ${formatCoins(amount)} coins`
        }
        onConfirm={() => {
          setTouched(true);
          if (problem === null && parsed.success) {
            onConfirm({ kind: 'grant', user, body: parsed.data });
          }
        }}
      >
        <div className="flex flex-col gap-4">
          <CurrencyInput
            label="Amount"
            value={amount}
            min={-MAX_GRANT}
            max={MAX_GRANT}
            help="A negative amount takes coins back."
            onChange={setAmount}
          />
          <Input
            label="Reason"
            value={reason}
            maxLength={500}
            placeholder="e.g. Compensation for the outage on Oct 4"
            onChange={(event) => setReason(event.target.value)}
          />
          <p
            aria-live="polite"
            className="flex items-center gap-2 rounded-control border border-bd bg-bg px-3 py-2 font-mono text-small"
          >
            <span className="text-mut">Balance</span>
            <span className="text-tx">{formatCoins(user.currency)}</span>
            <ArrowRight aria-hidden className="size-3.5 text-faint" />
            <span className="sr-only">after this change</span>
            <span
              className={cn(
                after < 0
                  ? 'text-red'
                  : amount === 0
                    ? 'text-tx'
                    : amount > 0
                      ? 'text-grn'
                      : 'text-gold',
              )}
            >
              {formatCoins(after)}
            </span>
          </p>
          {touched && problem ? (
            <p role="alert" className="text-small text-red">
              {problem}
            </p>
          ) : null}
        </div>
      </Dialog>
    );
  }

  if (asking.kind === 'role') {
    const promote = user.role === 'MEMBER';
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        tone={promote ? 'default' : 'danger'}
        icon={promote ? ShieldCheck : ShieldOff}
        title={promote ? `Make ${name} an admin?` : `Make ${name} a member again?`}
        description={
          promote
            ? 'They can grant coins, suspend accounts, change roles, edit pack templates and run syncs from their next request on.'
            : 'They lose every admin page and action on their next request. The last active admin cannot be demoted.'
        }
        confirmLabel={promote ? 'Make admin' : 'Make member'}
        onConfirm={() => onConfirm({ kind: 'role', user, role: promote ? 'ADMIN' : 'MEMBER' })}
      />
    );
  }

  if (asking.kind === 'suspend') {
    const parsed = SuspendUserSchema.safeParse({ reason });
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        tone="danger"
        icon={Ban}
        title={`Suspend ${name}?`}
        description="They are signed out everywhere at once and cannot sign in again until unsuspended. Every pending trade they are part of is voided and its locked cards released; voided trades stay voided."
        confirmLabel="Suspend account"
        onConfirm={() => {
          setTouched(true);
          if (parsed.success) onConfirm({ kind: 'suspend', user, reason: parsed.data.reason });
        }}
      >
        <Input
          label="Reason"
          value={reason}
          maxLength={500}
          placeholder="Recorded in the audit log"
          onChange={(event) => setReason(event.target.value)}
          error={
            touched && !parsed.success ? 'Say why — the reason goes into the audit log' : undefined
          }
        />
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      icon={Undo2}
      title={`Unsuspend ${name}?`}
      description="They can sign in again. Trades voided by the suspension stay voided."
      confirmLabel="Unsuspend"
      onConfirm={() => onConfirm({ kind: 'unsuspend', user })}
    />
  );
}
