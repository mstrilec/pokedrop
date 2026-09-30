import { z } from 'zod';

const EnvSchema = z.object({
  API_INTERNAL_URL: z.url().default('http://localhost:4000'),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
});

export const env = EnvSchema.parse({
  API_INTERNAL_URL: process.env.API_INTERNAL_URL,
  WEB_ORIGIN: process.env.WEB_ORIGIN,
});
