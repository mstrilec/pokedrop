import { UpdateMyProfileSchema, UserSearchQuerySchema } from '@pokedrop/shared';
import { createZodDto } from '../common/zod-dto.js';

export class UpdateMyProfileDto extends createZodDto('UpdateMyProfile', UpdateMyProfileSchema) {}

export class UserSearchQueryDto extends createZodDto('UserSearchQuery', UserSearchQuerySchema) {}
