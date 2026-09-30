import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { PackTemplate } from '@pokedrop/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../common/request-auth.js';
import { PackTemplatesService } from './pack-templates.service.js';
import { CreatePackTemplateDto, UpdatePackTemplateDto } from './packs.dto.js';
import { Doc, returns } from '../common/openapi.js';
import { PackTemplateSchema } from '@pokedrop/shared';
import { z } from 'zod';

@ApiTags('admin')
@Roles(['ADMIN'])
@Controller('admin/pack-templates')
export class AdminPackTemplatesController {
  constructor(private readonly templates: PackTemplatesService) {}

  @Doc(
    'Every pack template, active or not',
    returns('PackTemplateList', z.array(PackTemplateSchema)),
  )
  @Get()
  list(): Promise<PackTemplate[]> {
    return this.templates.listAll();
  }

  @Doc(
    'Create a pack template; its rarities must exist in its sets',
    returns('PackTemplate', PackTemplateSchema),
  )
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: CreatePackTemplateDto,
  ): Promise<PackTemplate> {
    return this.templates.create(user.id, body);
  }

  @Doc('Edit or deactivate a pack template', returns('PackTemplate', PackTemplateSchema))
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdatePackTemplateDto,
  ): Promise<PackTemplate> {
    return this.templates.update(user.id, id, body);
  }
}
