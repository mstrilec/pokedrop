import { Global, Module } from '@nestjs/common';
import { WelcomeGrantService } from './welcome-grant.service.js';

/**
 * Where currency is written. The welcome grant is the first tenant; PD-58's
 * pack spend and PD-68's trade settlement join it, and all three share the
 * ledger invariant that a balance never moves without a row to explain it.
 *
 * Global for the same reason RedisModule is — the auth module needs it, and
 * making each feature module declare the import would be noise.
 */
@Global()
@Module({
  providers: [WelcomeGrantService],
  exports: [WelcomeGrantService],
})
export class EconomyModule {}
