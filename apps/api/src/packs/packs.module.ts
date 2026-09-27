import { Module } from '@nestjs/common';
import { AdminPackTemplatesController } from './admin-pack-templates.controller.js';
import { PackTemplatesService } from './pack-templates.service.js';
import { PacksController } from './packs.controller.js';

@Module({
  controllers: [PacksController, AdminPackTemplatesController],
  providers: [PackTemplatesService],
})
export class PacksModule {}
