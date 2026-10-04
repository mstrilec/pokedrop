import { z } from 'zod';
import { post } from '../core';

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
