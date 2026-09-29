import { UpdateMyProfileSchema } from '@pokedrop/shared';
import { createZodDto } from '../common/zod-dto.js';

export class UpdateMyProfileDto extends createZodDto('UpdateMyProfile', UpdateMyProfileSchema) {}
