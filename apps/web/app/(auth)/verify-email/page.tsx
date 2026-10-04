import { MailCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthCard } from '@/components/auth/auth-card';
import { CheckInbox, LinkExpired, Verified } from '@/components/auth/verify-email';

export const metadata: Metadata = { title: 'Verify your email' };

// Better Auth's link lands here: `?verified=1` on success, `&error=…` when the token failed.
export default async function VerifyEmailPage({ searchParams }: PageProps<'/verify-email'>) {
  const { verified, error } = await searchParams;
  const state = error ? 'expired' : verified === '1' ? 'verified' : 'pending';

  return (
    <AuthCard
      icon={MailCheck}
      title={state === 'verified' ? 'Email verified' : 'Verify your email'}
      description={
        state === 'verified' ? 'One step left: sign in.' : 'One last step to activate your account.'
      }
      footer={
        state === 'verified' ? null : (
          <Link href="/sign-in" className="focus-ring rounded-tag text-pri hover:underline">
            Back to sign in
          </Link>
        )
      }
    >
      {state === 'verified' ? <Verified /> : state === 'expired' ? <LinkExpired /> : <CheckInbox />}
    </AuthCard>
  );
}
