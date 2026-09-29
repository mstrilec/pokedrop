import {
  AdminUserListQuerySchema,
  ChangeRoleSchema,
  GrantCurrencySchema,
  SuspendUserSchema,
} from '@pokedrop/shared';
import { createZodDto } from '../common/zod-dto.js';

export class AdminUserListQueryDto extends createZodDto(
  'AdminUserListQuery',
  AdminUserListQuerySchema,
) {}

export class ChangeRoleDto extends createZodDto('ChangeRole', ChangeRoleSchema) {}

export class GrantCurrencyDto extends createZodDto('GrantCurrency', GrantCurrencySchema) {}

export class SuspendUserDto extends createZodDto('SuspendUser', SuspendUserSchema) {}
