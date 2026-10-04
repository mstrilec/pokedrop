import { UserPlus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthCard } from '@/components/auth/auth-card';
import { RegisterForm } from '@/components/auth/register-form';
import { redirectIfSignedIn } from '@/lib/session/server';

export const metadata: Metadata = { title: 'Create account' };

export default async function RegisterPage() {
  await redirectIfSignedIn();

  return (
    <AuthCard
      icon={UserPlus}
      title="Create your account"
      description="Free to play. Verify your email to claim 1,000 welcome coins."
      footer={
        <>
          Already have one?{' '}
          <Link
            href="/sign-in"
            className="focus-ring rounded-tag font-medium text-pri hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthCard>
  );
}
