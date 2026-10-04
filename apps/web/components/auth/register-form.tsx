'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { PASSWORD_MIN_LENGTH, type SignUp, SignUpSchema } from '@pokedrop/shared';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { applyApiError, Form, FormError, FormField } from '@/components/ui/form';
import { authApi } from '@/lib/api/browser';
import { signUp } from '@/lib/api/endpoints/auth';
import { rememberPendingVerification, verifiedCallbackUrl } from '@/lib/auth-flow';

export function RegisterForm() {
  const router = useRouter();
  const form = useForm<SignUp>({
    resolver: zodResolver(SignUpSchema),
    mode: 'onTouched',
    defaultValues: { displayName: '', email: '', password: '' },
  });

  async function submit(values: SignUp) {
    try {
      await authApi.call(
        signUp({
          name: values.displayName,
          email: values.email,
          password: values.password,
          callbackURL: verifiedCallbackUrl(),
        }),
      );
    } catch (error) {
      applyApiError(form, error, {
        INVALID_PROFILE: 'displayName',
        INVALID_EMAIL: 'email',
        PASSWORD_TOO_SHORT: 'password',
        PASSWORD_TOO_LONG: 'password',
      });
      return;
    }
    rememberPendingVerification(values.email);
    router.push('/verify-email');
  }

  return (
    <Form form={form} onSubmit={submit}>
      <FormField<SignUp>
        name="displayName"
        label="Display name"
        autoComplete="nickname"
        help="Shown on your profile and in trades."
      />
      <FormField<SignUp> name="email" label="Email" type="email" autoComplete="email" />
      <FormField<SignUp>
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        help={`At least ${PASSWORD_MIN_LENGTH} characters.`}
      />
      <FormError />
      <Button type="submit" size="lg" loading={form.formState.isSubmitting}>
        Create account
      </Button>
    </Form>
  );
}
