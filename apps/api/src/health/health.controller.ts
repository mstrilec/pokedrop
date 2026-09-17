import { Controller, Get, UseFilters } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import type { HealthCheckResult } from '@nestjs/terminus';
import { PrismaService } from '../prisma/index.js';
import { HealthCheckFilter } from './health-check.filter.js';
import { RedisHealthIndicator } from './redis.health.js';

/**
 * How long a dependency has to answer before it counts as down. Short enough
 * that the probe resolves well inside an orchestrator's own timeout, long
 * enough not to fail on a slow but working connection.
 */
const DEPENDENCY_TIMEOUT_MS = 1500;

@ApiTags('health')
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

  /**
   * Liveness: does the process answer at all.
   *
   * Deliberately dependency-free. A liveness probe that fails because the
   * database is down would have an orchestrator restarting a perfectly healthy
   * process, which does nothing for the database and drops every request in
   * flight.
   */
  @Get('live')
  @HealthCheck()
  live(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  /** Readiness: can this instance actually serve a request right now. */
  @Get('ready')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.database.pingCheck('database', this.prisma).withTimeout(DEPENDENCY_TIMEOUT_MS),
      () => this.redis.pingCheck('redis', DEPENDENCY_TIMEOUT_MS),
    ]);
  }
}
