import { Lock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthCard, AuthNotice } from '@/components/auth/auth-card';
import { ResetPasswordForm } from '@/components/auth/password-forms';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Set a new password' };

// Better Auth's link lands here with `?token=…`, or `?error=INVALID_TOKEN` when it failed.
export default async function ResetPasswordPage({ searchParams }: PageProps<'/reset-password'>) {
  const { token, error } = await searchParams;
  const usable = typeof token === 'string' && token !== '' && !error;

  return (
    <AuthCard
      icon={Lock}
      title="Set a new password"
      description="Choose a strong password for your account."
      footer={
        <Link href="/sign-in" className="focus-ring rounded-tag text-pri hover:underline">
          Back to sign in
        </Link>
      }
    >
      {usable ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="flex flex-col gap-1">
          <AuthNotice tone="error">This reset link has expired or was already used.</AuthNotice>
          <Button asChild size="lg">
            <Link href="/forgot-password">Request a new link</Link>
          </Button>
        </div>
      )}
    </AuthCard>
  );
}
