import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { PackTemplate } from '@pokedrop/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../common/request-auth.js';
import { PackTemplatesService } from './pack-templates.service.js';
import { CreatePackTemplateDto, UpdatePackTemplateDto } from './packs.dto.js';

@ApiTags('admin')
@Roles(['ADMIN'])
@Controller('admin/pack-templates')
export class AdminPackTemplatesController {
  constructor(private readonly templates: PackTemplatesService) {}

  @Get()
  list(): Promise<PackTemplate[]> {
    return this.templates.listAll();
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: CreatePackTemplateDto,
  ): Promise<PackTemplate> {
    return this.templates.create(user.id, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdatePackTemplateDto,
  ): Promise<PackTemplate> {
    return this.templates.update(user.id, id, body);
  }
}
