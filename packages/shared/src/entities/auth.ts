import { z } from 'zod';
import { ProfileIdentitySchema } from './user.js';

/** Better Auth is configured with these same two bounds. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const EmailSchema = z.email('Enter a valid email address');

export const NewPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`);

export const SignUpSchema = z.object({
  displayName: ProfileIdentitySchema.shape.displayName,
  email: EmailSchema,
  password: NewPasswordSchema,
});
export type SignUp = z.infer<typeof SignUpSchema>;

/** Sign-in checks only that a password was typed: its rules are for new passwords. */
export const SignInSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, 'Enter your password'),
  rememberMe: z.boolean(),
});
export type SignIn = z.infer<typeof SignInSchema>;

export const ForgotPasswordSchema = z.object({ email: EmailSchema });
export type ForgotPassword = z.infer<typeof ForgotPasswordSchema>;

export const ResetPasswordSchema = z
  .object({ password: NewPasswordSchema, confirm: z.string() })
  .refine((value) => value.password === value.confirm, {
    path: ['confirm'],
    message: 'The passwords do not match',
  });
export type ResetPassword = z.infer<typeof ResetPasswordSchema>;

/** Settings: the current password is only checked by the server; the new one meets the rules. */
export const ChangePasswordSchema = z
  .object({
    current: z.string().min(1, 'Enter your current password'),
    password: NewPasswordSchema,
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, {
    path: ['confirm'],
    message: 'The passwords do not match',
  });
export type ChangePassword = z.infer<typeof ChangePasswordSchema>;
