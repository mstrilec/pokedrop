import { LogIn } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthCard, AuthNotice } from '@/components/auth/auth-card';
import { SignInForm } from '@/components/auth/sign-in-form';
import { redirectIfSignedIn } from '@/lib/session/server';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage({ searchParams }: PageProps<'/sign-in'>) {
  const { next, error, reset } = await searchParams;
  await redirectIfSignedIn(next);

  return (
    <AuthCard
      icon={LogIn}
      title="Welcome back"
      description="Sign in to your collection."
      footer={
        <>
          New here?{' '}
          <Link
            href="/register"
            className="focus-ring rounded-tag font-medium text-pri hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      {error === 'ACCOUNT_SUSPENDED' ? (
        <AuthNotice tone="error">This account is suspended.</AuthNotice>
      ) : reset === '1' ? (
        <AuthNotice tone="success">Your password is updated. Sign in with the new one.</AuthNotice>
      ) : null}
      <SignInForm next={typeof next === 'string' ? next : undefined} />
    </AuthCard>
  );
}
