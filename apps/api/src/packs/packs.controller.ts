import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { PackHistoryPage, PackOpenResult, PackTemplateView } from '@pokedrop/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/request-auth.js';
import { MODERATE_THROTTLE } from '../common/throttle.js';
import { PackHistoryService } from './pack-history.service.js';
import { PackOpeningService } from './pack-opening.service.js';
import { toTemplateView } from './pack-template.view.js';
import { PackTemplatesService } from './pack-templates.service.js';
import { OpenPackRequestDto, PackHistoryQueryDto } from './packs.dto.js';

@ApiTags('packs')
@Controller('packs')
export class PacksController {
  constructor(
    private readonly templates: PackTemplatesService,
    private readonly openings: PackOpeningService,
    private readonly history: PackHistoryService,
  ) {}

  @Get('templates')
  async listTemplates(): Promise<PackTemplateView[]> {
    return (await this.templates.listActive()).map(toTemplateView);
  }

  @Get('history')
  listHistory(
    @CurrentUser() user: AuthUser,
    @Query() query: PackHistoryQueryDto,
  ): Promise<PackHistoryPage> {
    return this.history.list(user.id, query);
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
