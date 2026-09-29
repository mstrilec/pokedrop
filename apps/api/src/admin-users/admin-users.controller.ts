import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AdminUserPage, AdminUserRow } from '@pokedrop/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../common/request-auth.js';
import { AdminUserListQueryDto, ChangeRoleDto } from './admin-users.dto.js';
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

  @Patch(':id/role')
  changeRole(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() body: ChangeRoleDto,
  ): Promise<AdminUserRow> {
    return this.users.changeRole(admin, id, body.role);
  }
}
