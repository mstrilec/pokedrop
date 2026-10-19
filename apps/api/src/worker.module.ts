import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppConfigModule } from './config/index.js';
import { WorkerLoggingModule } from './logging/index.js';
import { PrismaModule } from './prisma/index.js';
import { QueueModule } from './queue/index.js';
import { RedisModule } from './redis/index.js';
import { SyncModule } from './sync/index.js';
import { TradeExpiryModule } from './trades/index.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AppConfigModule,
    WorkerLoggingModule,
    PrismaModule,
    RedisModule,
    QueueModule,
    SyncModule,
    TradeExpiryModule,
  ],
})
export class WorkerModule {}
