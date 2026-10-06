'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type MyProfile, ProfileIdentitySchema } from '@pokedrop/shared';
import { Save } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { applyApiError, Form, FormError, FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useUpdateMe } from '@/lib/query/account';
import { toastSuccess } from '@/lib/toast';
import { SettingsSection } from './settings-section';

// The shared rules; an empty avatar field is "no avatar", which the API takes as null.
const ProfileFormSchema = z.object({
  displayName: ProfileIdentitySchema.shape.displayName,
  avatarUrl: z.literal('').or(ProfileIdentitySchema.shape.avatarUrl.unwrap()),
});
type ProfileForm = z.infer<typeof ProfileFormSchema>;

export function ProfileSettings({ me }: { me: MyProfile }) {
  const router = useRouter();
  const update = useUpdateMe();
  const form = useForm<ProfileForm>({
    resolver: zodResolver(ProfileFormSchema),
    mode: 'onTouched',
    defaultValues: { displayName: me.displayName, avatarUrl: me.avatarUrl ?? '' },
  });
  const [name, avatar] = useWatch({ control: form.control, name: ['displayName', 'avatarUrl'] });
  const preview = ProfileFormSchema.shape.avatarUrl.safeParse(avatar).success ? avatar : '';

  async function submit(values: ProfileForm) {
    try {
      const saved = await update.mutateAsync({
        displayName: values.displayName,
        avatarUrl: values.avatarUrl === '' ? null : values.avatarUrl,
      });
      form.reset({ displayName: saved.displayName, avatarUrl: saved.avatarUrl ?? '' });
      toastSuccess('Profile saved');
      // The shell's name and avatar come from the server render.
      router.refresh();
    } catch (error) {
      applyApiError(form, error);
    }
  }

  return (
    <SettingsSection
      id="profile"
      title="Profile"
      description={
        <>
          How you appear to other collectors, on{' '}
          <Link href={`/profile/${me.id}`} className="text-pri hover:underline">
            your public profile
          </Link>{' '}
          and in trades.
        </>
      }
    >
      <Form form={form} onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <Avatar name={name || me.displayName} src={preview || null} size={56} decorative />
          <p className="text-small text-mut">The preview follows what you type.</p>
        </div>
        <FormField<ProfileForm>
          name="displayName"
          label="Display name"
          autoComplete="nickname"
          maxLength={64}
          help="1–64 characters. Shown on your profile and in trades."
        />
        <FormField<ProfileForm>
          name="avatarUrl"
          label="Avatar image address"
          type="url"
          inputMode="url"
          placeholder="https://"
          help="An https:// link to an image. Leave it empty for your initial."
        />
        <Input
          label="Email"
          value={me.email}
          readOnly
          help="The address you sign in with. It can’t be changed here."
        />
        <FormError />
        <Button
          type="submit"
          icon={Save}
          className="self-start"
          loading={form.formState.isSubmitting}
          disabled={!form.formState.isDirty}
        >
          Save profile
        </Button>
      </Form>
    </SettingsSection>
  );
}
