'use client';

import { ArrowLeftRight, LogIn, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { signInUrl } from '@/lib/routes';
import { useSession } from '@/lib/session/context';

/** Edit for the owner, a trade for anyone else — after signing in, for a visitor. */
export function ProfileActions({ userId, name }: { userId: string; name: string }) {
  const session = useSession();
  const [asking, setAsking] = useState(false);
  const propose = `/trades/new?to=${encodeURIComponent(userId)}`;

  if (session?.id === userId) {
    return (
      <Button asChild variant="secondary" icon={Pencil}>
        <Link href="/settings">Edit profile</Link>
      </Button>
    );
  }
  if (session) {
    return (
      <Button asChild icon={ArrowLeftRight}>
        <Link href={propose}>Propose trade</Link>
      </Button>
    );
  }
  return (
    <>
      <Button icon={ArrowLeftRight} onClick={() => setAsking(true)}>
        Propose trade
      </Button>
      <Dialog
        open={asking}
        onOpenChange={setAsking}
        icon={LogIn}
        title={`Sign in to trade with ${name}`}
        description="Trades belong to your account. It’s free, and you start with coins for your first packs."
      >
        <div className="flex flex-col gap-2.5">
          <Button asChild>
            <Link href={signInUrl(propose)}>Sign in</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/register">Create an account</Link>
          </Button>
        </div>
      </Dialog>
    </>
  );
}
