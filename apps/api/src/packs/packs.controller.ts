import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { PackOpenResult, PackTemplate } from '@pokedrop/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/request-auth.js';
import { MODERATE_THROTTLE } from './pack-open.throttle.js';
import { PackOpeningService } from './pack-opening.service.js';
import { PackTemplatesService } from './pack-templates.service.js';
import { OpenPackRequestDto } from './packs.dto.js';

@ApiTags('packs')
@Controller('packs')
export class PacksController {
  constructor(
    private readonly templates: PackTemplatesService,
    private readonly openings: PackOpeningService,
  ) {}

  @Get('templates')
  listTemplates(): Promise<PackTemplate[]> {
    return this.templates.listActive();
  }

  @HttpCode(HttpStatus.OK)
  @Throttle(MODERATE_THROTTLE)
  @Post(':templateId/open')
  open(
    @CurrentUser() user: AuthUser,
    @Param('templateId') templateId: string,
    @Body() body: OpenPackRequestDto,
  ): Promise<PackOpenResult> {
    return this.openings.open(user.id, templateId, body.openId);
  }
}
