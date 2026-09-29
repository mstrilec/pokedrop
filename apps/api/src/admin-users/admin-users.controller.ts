import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AdminUserPage, AdminUserRow, GrantResult } from '@pokedrop/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../common/request-auth.js';
import {
  AdminUserListQueryDto,
  ChangeRoleDto,
  GrantCurrencyDto,
  SuspendUserDto,
} from './admin-users.dto.js';
import { AdminUsersService } from './admin-users.service.js';

@ApiTags('admin')
@Roles(['ADMIN'])
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  list(@Query() query: AdminUserListQueryDto): Promise<AdminUserPage> {
    return this.users.list(query);
  }

  /** 200 for the first request and a replay alike, as a pack open answers. */
  @HttpCode(HttpStatus.OK)
  @Post(':id/currency')
  grant(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() body: GrantCurrencyDto,
  ): Promise<GrantResult> {
    return this.users.grant(admin, id, body);
  }

  @Patch(':id/role')
  changeRole(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() body: ChangeRoleDto,
  ): Promise<AdminUserRow> {
    return this.users.changeRole(admin, id, body.role);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/suspend')
  suspend(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() body: SuspendUserDto,
  ): Promise<AdminUserRow> {
    return this.users.suspend(admin, id, body.reason);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/unsuspend')
  unsuspend(@CurrentUser() admin: AuthUser, @Param('id') id: string): Promise<AdminUserRow> {
    return this.users.unsuspend(admin, id);
  }
}
