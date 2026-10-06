import { z } from 'zod';
import { get, post } from '../core';

// Better Auth's routes, for authApi. Only what a page reads is parsed.

const UserRefSchema = z.object({ user: z.object({ id: z.string() }) });
const StatusSchema = z.object({ status: z.boolean() });

export const signUp = (body: {
  name: string;
  email: string;
  password: string;
  callbackURL: string;
}) => post('/sign-up/email', UserRefSchema, body);

export const signIn = (body: {
  email: string;
  password: string;
  rememberMe: boolean;
  callbackURL: string;
}) => post('/sign-in/email', UserRefSchema, body);

export const sendVerificationEmail = (body: { email: string; callbackURL: string }) =>
  post('/send-verification-email', StatusSchema, body);

export const requestPasswordReset = (body: { email: string; redirectTo: string }) =>
  post('/request-password-reset', StatusSchema, body);

export const resetPassword = (body: { newPassword: string; token: string }) =>
  post('/reset-password', StatusSchema, body);

export const changePassword = (body: {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions: boolean;
}) => post('/change-password', z.object({}).loose(), body);

// The answer also carries every session's token (Better Auth revokes by token); it is not read.
const SessionRowSchema = z.object({
  id: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  ipAddress: z.string().nullish(),
  userAgent: z.string().nullish(),
});
export type SessionRow = z.infer<typeof SessionRowSchema>;

export const listSessions = () => get('/list-sessions', z.array(SessionRowSchema));

export const currentSession = () =>
  get('/get-session', z.object({ session: z.object({ id: z.string() }) }).nullable());

export const revokeOtherSessions = () => post('/revoke-other-sessions', StatusSchema, {});
