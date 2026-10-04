'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type ForgotPassword, ForgotPasswordSchema } from '@pokedrop/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { applyApiError, Form, FormError, FormField } from '@/components/ui/form';
import { authApi } from '@/lib/api/browser';
import { sendVerificationEmail } from '@/lib/api/endpoints/auth';
import {
  forgetPendingVerification,
  RESEND_COOLDOWN_MS,
  rememberPendingVerification,
  usePendingVerification,
  verifiedCallbackUrl,
} from '@/lib/auth-flow';
import { apiErrorMessage } from '@/lib/toast';
import { AuthNotice } from './auth-card';

/** Seconds left until `deadline`, and a setter for the clock when the deadline moves. */
function useSecondsUntil(deadline: number): [number, (now: number) => void] {
  const [now, setNow] = useState(() => Date.now());
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
  useEffect(() => {
    if (remaining === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [remaining]);
  return [remaining, setNow];
}

async function resend(email: string): Promise<void> {
  await authApi.call(sendVerificationEmail({ email, callbackURL: verifiedCallbackUrl() }));
  rememberPendingVerification(email);
}

/** The address is known from this tab's sign-up or sign-in: one button, on a cooldown. */
function ResendButton({ email, sentAt }: { email: string; sentAt: number }) {
  const [lastSent, setLastSent] = useState(sentAt);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | { error: string }>('idle');
  const [wait, setNow] = useSecondsUntil(lastSent + RESEND_COOLDOWN_MS);

  async function send() {
    setState('sending');
    try {
      await resend(email);
      const sent = Date.now();
      setLastSent(sent);
      setNow(sent);
      setState('sent');
    } catch (error) {
      setState({ error: apiErrorMessage(error) });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {state === 'sent' ? <AuthNotice tone="success">We sent another link.</AuthNotice> : null}
      {typeof state === 'object' ? <AuthNotice tone="error">{state.error}</AuthNotice> : null}
      <Button
        variant="secondary"
        size="lg"
        loading={state === 'sending'}
        disabled={wait > 0}
        onClick={() => void send()}
      >
        {wait > 0 ? `Resend email in ${wait} s` : 'Resend email'}
      </Button>
    </div>
  );
}

/** Opened in another tab or browser, the address is unknown: ask for it. */
function ResendForm() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<ForgotPassword>({
    resolver: zodResolver(ForgotPasswordSchema),
    mode: 'onTouched',
    defaultValues: { email: '' },
  });

  async function submit({ email }: ForgotPassword) {
    try {
      await resend(email);
      setSentTo(email);
    } catch (error) {
      applyApiError(form, error);
    }
  }

  if (sentTo) {
    return (
      <AuthNotice tone="success">
        If {sentTo} has an account waiting for verification, a new link is on its way.
      </AuthNotice>
    );
  }
  return (
    <Form form={form} onSubmit={submit}>
      <FormField<ForgotPassword> name="email" label="Email" type="email" autoComplete="email" />
      <FormError />
      <Button type="submit" size="lg" loading={form.formState.isSubmitting}>
        Send a new link
      </Button>
    </Form>
  );
}

export function CheckInbox() {
  const pending = usePendingVerification();
  return (
    <div className="flex flex-col gap-5">
      <p className="text-body leading-relaxed text-mut">
        We sent a verification link to{' '}
        <strong className="text-tx">{pending?.email ?? 'your email address'}</strong>. Open it to
        activate your account and claim your <strong className="text-gold">1,000 coin</strong>{' '}
        welcome grant. The link works once.
      </p>
      {pending ? <ResendButton email={pending.email} sentAt={pending.sentAt} /> : <ResendForm />}
    </div>
  );
}

export function LinkExpired() {
  return (
    <div className="flex flex-col gap-5">
      <AuthNotice tone="error">That link has expired or was already used.</AuthNotice>
      <p className="text-body text-mut">
        Enter your email and we will send a new one. Signing in also sends a fresh link.
      </p>
      <ResendForm />
    </div>
  );
}

export function Verified() {
  useEffect(() => forgetPendingVerification(), []);
  return (
    <div className="flex flex-col gap-5">
      <AuthNotice tone="success">Your email is verified.</AuthNotice>
      <p className="text-body text-mut">
        Sign in and your <strong className="text-gold">1,000 welcome coins</strong> will be waiting.
      </p>
      <Button asChild size="lg">
        <Link href="/sign-in">Sign in</Link>
      </Button>
    </div>
  );
}
