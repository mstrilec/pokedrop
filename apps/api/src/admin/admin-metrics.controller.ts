import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AdminMetrics } from '@pokedrop/shared';
import { Roles } from '../common/decorators/roles.decorator.js';
import { AdminMetricsQueryDto } from './admin-metrics.dto.js';
import { AdminMetricsService } from './admin-metrics.service.js';

@ApiTags('admin')
@Roles(['ADMIN'])
@Controller('admin')
export class AdminMetricsController {
  constructor(private readonly metrics: AdminMetricsService) {}

  @Get('metrics')
  get(@Query() query: AdminMetricsQueryDto): Promise<AdminMetrics> {
    return this.metrics.metrics(query.days);
  }
}
