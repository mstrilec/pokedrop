import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/index.js';
import { AdminPackTemplatesController } from './admin-pack-templates.controller.js';
import { PackOpenLock } from './pack-open.lock.js';
import { PackOpeningService } from './pack-opening.service.js';
import { PackTemplatesService } from './pack-templates.service.js';
import { PacksController } from './packs.controller.js';

@Module({
  imports: [InventoryModule],
  controllers: [PacksController, AdminPackTemplatesController],
  providers: [PackTemplatesService, PackOpeningService, PackOpenLock],
})
export class PacksModule {}
