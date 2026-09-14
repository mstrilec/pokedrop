import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

/**
 * Liveness only: does the process answer at all.
 *
 * PD-20 replaces this with @nestjs/terminus and adds `/health/ready`, which
 * checks Postgres and Redis. Deliberately kept dependency-free here — a
 * liveness probe that fails because the database is down would have an
 * orchestrator restarting a perfectly healthy process.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get('live')
  @ApiOkResponse({
    description: 'The process is running.',
    schema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['ok'] } },
      required: ['status'],
    },
  })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
