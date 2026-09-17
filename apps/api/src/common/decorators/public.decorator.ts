import { Reflector } from '@nestjs/core';

/**
 * Opts a route out of the global session guard.
 *
 * Built with Reflector.createDecorator rather than SetMetadata with a string
 * key, so the guard reads it through the same typed handle and a typo cannot
 * silently make a route look protected when it is not.
 */
export const Public = Reflector.createDecorator<void>();
