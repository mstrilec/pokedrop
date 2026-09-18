import { Controller, Get, UseFilters } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator.js';
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import type { HealthCheckResult } from '@nestjs/terminus';
import { PrismaService } from '../prisma/index.js';
import { HealthCheckFilter } from './health-check.filter.js';
import { RedisHealthIndicator } from './redis.health.js';

const DEPENDENCY_TIMEOUT_MS = 1500;

@ApiTags('health')
@SkipThrottle()
@Public()
@UseFilters(HealthCheckFilter)
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Get('live')
  @HealthCheck()
  live(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  @Get('ready')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.database.pingCheck('database', this.prisma).withTimeout(DEPENDENCY_TIMEOUT_MS),
      () => this.redis.pingCheck('redis', DEPENDENCY_TIMEOUT_MS),
    ]);
  }
}
