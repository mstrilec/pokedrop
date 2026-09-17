import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service.js';

/**
 * Global for the same reason RedisModule is: the auth module needs it, PD-31
 * and PD-32 will, and making each declare the import would be noise.
 */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
