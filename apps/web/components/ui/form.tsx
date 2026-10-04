'use client';

import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  type FieldPath,
  type FieldValues,
  FormProvider,
  get,
  type SubmitHandler,
  type UseFormReturn,
  useController,
  useFormContext,
} from 'react-hook-form';
import { ApiError } from '@/lib/api/core';
import { apiErrorMessage } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { Input, type InputProps } from './input';
import { Toggle, type ToggleProps } from './toggle';

export function Form<T extends FieldValues>({
  form,
  onSubmit,
  children,
  className,
}: {
  form: UseFormReturn<T>;
  onSubmit: SubmitHandler<T>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <FormProvider {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('flex flex-col gap-4', className)}
      >
        {children}
      </form>
    </FormProvider>
  );
}

export function FormField<T extends FieldValues = FieldValues>({
  name,
  ...props
}: Omit<InputProps, 'name' | 'error'> & { name: FieldPath<T> }) {
  const {
    register,
    formState: { errors },
  } = useFormContext<T>();
  const message: unknown = get(errors, name)?.message;
  return (
    <Input
      {...props}
      {...register(name)}
      error={typeof message === 'string' ? message : undefined}
    />
  );
}

export function FormToggle<T extends FieldValues = FieldValues>({
  name,
  ...props
}: Omit<ToggleProps, 'checked' | 'onCheckedChange' | 'name' | 'onBlur'> & {
  name: FieldPath<T>;
}) {
  const { field } = useController<T>({ name });
  return (
    <Toggle
      {...props}
      name={field.name}
      checked={Boolean(field.value)}
      onCheckedChange={field.onChange}
      onBlur={field.onBlur}
    />
  );
}

export function FormError() {
  const {
    formState: { errors },
  } = useFormContext();
  const message = errors.root?.message;
  if (!message) return null;
  return (
    <p
      role="alert"
      className="flex items-center gap-2 rounded-control border border-red/30 bg-red-dim px-3 py-2 text-small text-red"
    >
      <CircleAlert aria-hidden className="size-4 shrink-0" />
      {message}
    </p>
  );
}

export function applyApiError<T extends FieldValues>(
  form: UseFormReturn<T>,
  error: unknown,
  fields: Partial<Record<string, FieldPath<T>>> = {},
): void {
  const field = error instanceof ApiError && error.code ? fields[error.code] : undefined;
  const message = apiErrorMessage(error);
  if (field) form.setError(field, { type: 'server', message }, { shouldFocus: true });
  else form.setError('root', { type: 'server', message });
}
