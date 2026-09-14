import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/**
 * Global so that no feature module has to import it to reach the database.
 * Every module in docs/Architecture.md section 4 needs Prisma; making each one
 * declare it would be noise.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
