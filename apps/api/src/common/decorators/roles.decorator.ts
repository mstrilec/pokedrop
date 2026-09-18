import { Reflector } from '@nestjs/core';
import type { Role } from '@pokedrop/shared';

export const Roles = Reflector.createDecorator<readonly Role[]>();
