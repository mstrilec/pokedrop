import { Module } from '@nestjs/common';
import { AdminAuditController } from './admin-audit.controller.js';
import { AdminAuditService } from './admin-audit.service.js';

@Module({ controllers: [AdminAuditController], providers: [AdminAuditService] })
export class AdminAuditModule {}
