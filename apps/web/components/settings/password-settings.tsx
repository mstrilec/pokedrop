'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type ChangePassword, ChangePasswordSchema, PASSWORD_MIN_LENGTH } from '@pokedrop/shared';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { applyApiError, Form, FormError, FormField } from '@/components/ui/form';
import { Toggle } from '@/components/ui/toggle';
import { ApiError } from '@/lib/api/core';
import { useChangePassword } from '@/lib/query/account';
import { toastSuccess } from '@/lib/toast';
import { SettingsSection } from './settings-section';

export function PasswordSettings() {
  const change = useChangePassword();
  const [signOutOthers, setSignOutOthers] = useState(true);
  const form = useForm<ChangePassword>({
    resolver: zodResolver(ChangePasswordSchema),
    mode: 'onTouched',
    defaultValues: { current: '', password: '', confirm: '' },
  });

  async function submit(values: ChangePassword) {
    try {
      await change.mutateAsync({
        currentPassword: values.current,
        newPassword: values.password,
        revokeOtherSessions: signOutOthers,
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_PASSWORD') {
        form.setError(
          'current',
          { type: 'server', message: 'That isn’t your current password' },
          { shouldFocus: true },
        );
        return;
      }
      applyApiError(form, error, { PASSWORD_TOO_SHORT: 'password', PASSWORD_TOO_LONG: 'password' });
      return;
    }
    form.reset();
    toastSuccess(
      signOutOthers
        ? 'Password changed. Every other device was signed out.'
        : 'Password changed. Your other devices stay signed in.',
    );
  }

  return (
    <SettingsSection
      id="password"
      title="Password"
      description="Changing it needs the one you use now. This device stays signed in."
    >
      <Form form={form} onSubmit={submit} className="flex flex-col gap-4">
        {/* For password managers: which account this form belongs to. */}
        <input type="text" name="username" autoComplete="username" hidden readOnly />
        <FormField<ChangePassword>
          name="current"
          label="Current password"
          type="password"
          autoComplete="current-password"
        />
        <FormField<ChangePassword>
          name="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          help={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        />
        <FormField<ChangePassword>
          name="confirm"
          label="Repeat the new password"
          type="password"
          autoComplete="new-password"
        />
        <Toggle
          label="Sign out of every other device"
          description="Recommended if you change it because someone else might know it."
          checked={signOutOthers}
          onCheckedChange={setSignOutOthers}
        />
        <FormError />
        <Button
          type="submit"
          icon={KeyRound}
          className="self-start"
          loading={form.formState.isSubmitting}
        >
          Change password
        </Button>
      </Form>
    </SettingsSection>
  );
}
