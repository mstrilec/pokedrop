import { Global, Module } from '@nestjs/common';
import { WelcomeGrantService } from './welcome-grant.service.js';

@Global()
@Module({
  providers: [WelcomeGrantService],
  exports: [WelcomeGrantService],
})
export class EconomyModule {}
