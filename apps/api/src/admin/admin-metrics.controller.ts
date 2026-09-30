import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AdminMetrics } from '@pokedrop/shared';
import { Roles } from '../common/decorators/roles.decorator.js';
import { AdminMetricsQueryDto } from './admin-metrics.dto.js';
import { AdminMetricsService } from './admin-metrics.service.js';
import { Doc, returns } from '../common/openapi.js';
import { AdminMetricsSchema } from '@pokedrop/shared';

@ApiTags('admin')
@Roles(['ADMIN'])
@Controller('admin')
export class AdminMetricsController {
  constructor(private readonly metrics: AdminMetricsService) {}

  @Doc(
    'Daily activity, packs, trades, errors and freshness for the dashboard',
    returns('AdminMetrics', AdminMetricsSchema),
  )
  @Get('metrics')
  get(@Query() query: AdminMetricsQueryDto): Promise<AdminMetrics> {
    return this.metrics.metrics(query.days);
  }
}
