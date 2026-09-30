import { Global, Module } from '@nestjs/common';
import { ActivityService } from './activity.service.js';
import { MetricsCounterService } from './metrics-counter.service.js';

@Global()
@Module({
  providers: [ActivityService, MetricsCounterService],
  exports: [ActivityService, MetricsCounterService],
})
export class MetricsModule {}
