'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  type ForgotPassword,
  ForgotPasswordSchema,
  PASSWORD_MIN_LENGTH,
  type ResetPassword,
  ResetPasswordSchema,
} from '@pokedrop/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { applyApiError, Form, FormError, FormField } from '@/components/ui/form';
import { ApiError } from '@/lib/api/core';
import { authApi } from '@/lib/api/browser';
import { requestPasswordReset, resetPassword } from '@/lib/api/endpoints/auth';
import { AuthNotice } from './auth-card';

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const form = useForm<ForgotPassword>({
    resolver: zodResolver(ForgotPasswordSchema),
    mode: 'onTouched',
    defaultValues: { email: '' },
  });

  async function submit({ email }: ForgotPassword) {
    try {
      await authApi.call(
        requestPasswordReset({ email, redirectTo: `${window.location.origin}/reset-password` }),
      );
      setSent(true);
    } catch (error) {
      applyApiError(form, error);
    }
  }

  // The API answers the same for any address, so the page does too.
  if (sent) {
    return (
      <AuthNotice tone="success">
        If an account uses that address, a reset link is on its way. It works once and expires soon,
        so use it now.
      </AuthNotice>
    );
  }
  return (
    <Form form={form} onSubmit={submit}>
      <FormField<ForgotPassword> name="email" label="Email" type="email" autoComplete="email" />
      <FormError />
      <Button type="submit" size="lg" loading={form.formState.isSubmitting}>
        Send reset link
      </Button>
    </Form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const form = useForm<ResetPassword>({
    resolver: zodResolver(ResetPasswordSchema),
    mode: 'onTouched',
    defaultValues: { password: '', confirm: '' },
  });

  async function submit({ password }: ResetPassword) {
    try {
      await authApi.call(resetPassword({ newPassword: password, token }));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_TOKEN') {
        form.setError('root', {
          type: 'server',
          message: 'This reset link has expired or was already used. Request a new one.',
        });
        return;
      }
      applyApiError(form, error, { PASSWORD_TOO_SHORT: 'password', PASSWORD_TOO_LONG: 'password' });
      return;
    }
    router.push('/sign-in?reset=1');
  }

  return (
    <Form form={form} onSubmit={submit}>
      <FormField<ResetPassword>
        name="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        help={`At least ${PASSWORD_MIN_LENGTH} characters. Every device you are signed in on will be signed out.`}
      />
      <FormField<ResetPassword>
        name="confirm"
        label="Repeat the new password"
        type="password"
        autoComplete="new-password"
      />
      <FormError />
      <Button type="submit" size="lg" loading={form.formState.isSubmitting}>
        Update password
      </Button>
    </Form>
  );
}
