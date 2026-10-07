import { z } from 'zod';

export const HttpsUrlSchema = z
  .url({ protocol: /^https$/, error: 'Use an https:// address' })
  .max(2048);
