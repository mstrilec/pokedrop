import { KeyRound } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthCard } from '@/components/auth/auth-card';
import { ForgotPasswordForm } from '@/components/auth/password-forms';

export const metadata: Metadata = { title: 'Reset your password' };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      icon={KeyRound}
      title="Reset your password"
      description="Enter your email and we will send you a reset link."
      footer={
        <Link href="/sign-in" className="focus-ring rounded-tag text-pri hover:underline">
          Back to sign in
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
