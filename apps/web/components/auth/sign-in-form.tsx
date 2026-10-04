'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type SignIn, SignInSchema } from '@pokedrop/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { applyApiError, Form, FormError, FormField, FormToggle } from '@/components/ui/form';
import { ApiError } from '@/lib/api/core';
import { authApi } from '@/lib/api/browser';
import { signIn } from '@/lib/api/endpoints/auth';
import { rememberPendingVerification, verifiedCallbackUrl } from '@/lib/auth-flow';
import { safeNext } from '@/lib/routes';

export function SignInForm({ next }: { next?: string }) {
  const router = useRouter();
  const form = useForm<SignIn>({
    resolver: zodResolver(SignInSchema),
    mode: 'onTouched',
    defaultValues: { email: '', password: '', rememberMe: true },
  });

  async function submit(values: SignIn) {
    try {
      await authApi.call(signIn({ ...values, callbackURL: verifiedCallbackUrl() }));
    } catch (error) {
      // Refused only after the password matched, and a fresh link is already on its way.
      if (error instanceof ApiError && error.code === 'EMAIL_NOT_VERIFIED') {
        rememberPendingVerification(values.email);
        router.push('/verify-email');
        return;
      }
      applyApiError(form, error);
      return;
    }
    // A full load, so every layout renders again with the new session.
    window.location.assign(safeNext(next));
  }

  return (
    <Form form={form} onSubmit={submit}>
      <FormField<SignIn> name="email" label="Email" type="email" autoComplete="email" />
      <div className="flex flex-col gap-1.5">
        <FormField<SignIn>
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
        />
        <Link
          href="/forgot-password"
          className="focus-ring self-end rounded-tag text-small text-pri hover:underline"
        >
          Forgot your password?
        </Link>
      </div>
      <FormToggle<SignIn> name="rememberMe" label="Keep me signed in on this device" />
      <FormError />
      <Button type="submit" size="lg" loading={form.formState.isSubmitting}>
        Sign in
      </Button>
    </Form>
  );
}
