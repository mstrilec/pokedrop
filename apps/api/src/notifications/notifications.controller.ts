import { Controller, Get, HttpCode, HttpStatus, Param, Patch, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { MarkAllRead, NotificationPage, UnreadCount } from '@pokedrop/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/request-auth.js';
import { NotificationReadsService } from './notification-reads.service.js';
import { NotificationListQueryDto } from './notifications.dto.js';
import { Doc, returns } from '../common/openapi.js';
import { MarkAllReadSchema, NotificationPageSchema, UnreadCountSchema } from '@pokedrop/shared';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly reads: NotificationReadsService) {}

  @Doc(
    "Page the caller's notifications, newest first",
    returns('NotificationPage', NotificationPageSchema),
  )
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: NotificationListQueryDto,
  ): Promise<NotificationPage> {
    return this.reads.list(user, query);
  }

  @Doc('How many notifications are unread', returns('UnreadCount', UnreadCountSchema))
  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser): Promise<UnreadCount> {
    return this.reads.unreadCount(user);
  }

  @Doc('Mark every notification read', returns('MarkAllRead', MarkAllReadSchema))
  @Patch('read-all')
  markAllRead(@CurrentUser() user: AuthUser): Promise<MarkAllRead> {
    return this.reads.markAllRead(user);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Doc('Mark one notification read')
  @Patch(':id/read')
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    return this.reads.markRead(user, id);
  }
}
