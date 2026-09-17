import { Reflector } from '@nestjs/core';
import type { Role } from '@pokedrop/shared';

/**
 * Restricts a route to the listed roles.
 *
 * Typed against the shared `Role` union rather than a loose string, so a
 * misspelled role is a compile error instead of a route nobody can reach.
 */
export const Roles = Reflector.createDecorator<readonly Role[]>();
