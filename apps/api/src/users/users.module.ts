import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/index.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [InventoryModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
