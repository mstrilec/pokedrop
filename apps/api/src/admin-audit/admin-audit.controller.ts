import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuditPageSchema, type AuditPage } from '@pokedrop/shared';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Doc, returns } from '../common/openapi.js';
import { AuditQueryDto } from './admin-audit.dto.js';
import { AdminAuditService } from './admin-audit.service.js';

@ApiTags('admin')
@Roles(['ADMIN'])
@Controller('admin/audit')
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditService) {}

  @Doc('The audit log, newest first, filtered; read-only', returns('AuditPage', AuditPageSchema))
  @Get()
  list(@Query() query: AuditQueryDto): Promise<AuditPage> {
    return this.audit.list(query);
  }
}
