import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { MyProfile, PublicProfile } from '@pokedrop/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import type { AuthUser } from '../common/request-auth.js';
import { UpdateMyProfileDto } from './users.dto.js';
import { UsersService } from './users.service.js';
import { Doc, returns } from '../common/openapi.js';
import { MyProfileSchema, PublicProfileSchema } from '@pokedrop/shared';

/** `me` is declared before `:id` so it is never read as a user id. */
@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Doc("The caller's own profile, privacy settings included", returns('MyProfile', MyProfileSchema))
  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<MyProfile> {
    return this.users.me(user.id);
  }

  @Doc(
    "Update the caller's profile, privacy toggles and showcase",
    returns('MyProfile', MyProfileSchema),
  )
  @Patch('me')
  updateMe(@CurrentUser() user: AuthUser, @Body() body: UpdateMyProfileDto): Promise<MyProfile> {
    return this.users.updateMe(user.id, body);
  }

  @Public()
  @Doc(
    "A user's public profile, as their privacy settings allow",
    returns('PublicProfile', PublicProfileSchema),
  )
  @Get(':id')
  profile(@Param('id') id: string): Promise<PublicProfile> {
    return this.users.publicProfile(id);
  }
}
