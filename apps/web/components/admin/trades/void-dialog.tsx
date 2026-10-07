'use client';

import { type TradeDetail, VoidTradeSchema } from '@pokedrop/shared';
import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { apiErrorMessage, toastSuccess } from '@/lib/toast';
import { useVoidCheck, useVoidTrade } from '@/lib/query/admin';

/** Asks the server first; a void it would refuse is never offered (PD-123 AC1). */
export function VoidDialog({
  trade,
  open,
  onClose,
  onSettled,
}: {
  trade: TradeDetail;
  open: boolean;
  onClose: () => void;
  /** After a void or a refusal: re-read the trade. */
  onSettled: () => void;
}) {
  const voiding = useVoidTrade();
  // Off once a void is sent: the void's own invalidation would re-run the check against the
  // trade it just closed and announce a refusal for a void that succeeded.
  const check = useVoidCheck(trade.id, open && voiding.isIdle);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const parsed = VoidTradeSchema.safeParse({ reason });
  const accepted = trade.status === 'ACCEPTED';
  const a = trade.initiator.displayName;
  const b = trade.recipient.displayName;
  const voidable = check.data?.voidable === true && refused === null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      tone="danger"
      icon={ShieldAlert}
      title={`Void the trade between ${a} and ${b}?`}
      description={
        accepted
          ? `The swap is undone: every card and coin goes back to the side it came from. Both are notified.`
          : `The offer closes as Voided and ${a}’s locked copies are released. Both are notified.`
      }
      confirmLabel={voidable ? 'Void trade' : undefined}
      confirming={voiding.isPending}
      onConfirm={
        voidable
          ? () => {
              setTouched(true);
              if (!parsed.success) return;
              voiding.mutate(
                { id: trade.id, reason: parsed.data.reason },
                {
                  onSuccess: () => {
                    toastSuccess(`Voided the trade between ${a} and ${b}`);
                    onSettled();
                    onClose();
                  },
                  onError: (error) => {
                    setRefused(apiErrorMessage(error));
                    onSettled();
                  },
                },
              );
            }
          : undefined
      }
    >
      {check.isPending ? (
        <p role="status" className="flex items-center gap-2 text-small text-mut">
          <Spinner size={16} /> Checking whether this trade can be voided…
        </p>
      ) : check.isError ? (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-small text-red">
            Couldn’t check whether this trade can be voided: {apiErrorMessage(check.error)}
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() => void check.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : refused !== null ? (
        <p role="alert" className="text-small text-red">
          Not voided: {refused}
        </p>
      ) : check.data && !check.data.voidable ? (
        <p role="alert" className="text-small text-red">
          This trade can’t be voided now: {check.data.reason}
        </p>
      ) : (
        <Input
          label="Reason"
          value={reason}
          maxLength={500}
          placeholder="Recorded in the audit log; the members are not shown it"
          onChange={(event) => setReason(event.target.value)}
          error={touched && !parsed.success ? 'Say why — 1 to 500 characters' : undefined}
        />
      )}
      {voidable ? null : (
        <Button variant="secondary" className="mt-4 w-full" onClick={onClose}>
          Close
        </Button>
      )}
    </Dialog>
  );
}
