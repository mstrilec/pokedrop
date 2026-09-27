import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { PackTemplate } from '@pokedrop/shared';
import { PackTemplatesService } from './pack-templates.service.js';

@ApiTags('packs')
@Controller('packs')
export class PacksController {
  constructor(private readonly templates: PackTemplatesService) {}

  @Get('templates')
  listTemplates(): Promise<PackTemplate[]> {
    return this.templates.listActive();
  }
}
