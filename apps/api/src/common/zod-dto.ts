import { z } from 'zod';
import type { OpenAPIObject } from '@nestjs/swagger';

/**
 * Binds a Zod schema to a class so Nest can carry it as a parameter metatype,
 * and records it so the OpenAPI document can describe it.
 *
 * nestjs-zod would normally do this, but it declares peers of @nestjs/common
 * ^10 || ^11 and @nestjs/swagger ^7 || ^8 || ^11 while this repo runs 12 of
 * both. Zod 4 ships `toJSONSchema`, which is the only part that was hard to
 * write by hand.
 *
 * The name is passed explicitly rather than taken from a subclass because
 * @nestjs/swagger keys `components.schemas` by class name, and a class
 * returned from a factory does not know what it will be called.
 */
export interface ZodDtoStatic<T extends z.ZodType = z.ZodType> {
  new (): z.infer<T>;
  readonly zodSchema: T;
}

const registry = new Map<string, Record<string, unknown>>();

export function createZodDto<T extends z.ZodType>(name: string, schema: T): ZodDtoStatic<T> {
  class ZodDto {
    static readonly zodSchema = schema;
  }

  Object.defineProperty(ZodDto, 'name', { value: name });

  // `io: 'input'` matters: for a field with .default() the input form is
  // optional and the output form is required, and request documentation
  // describes what the caller sends.
  const jsonSchema = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;

  // OpenAPI has no use for the draft identifier Zod emits.
  delete jsonSchema['$schema'];

  registry.set(name, jsonSchema);

  return ZodDto as unknown as ZodDtoStatic<T>;
}

export function isZodDto(metatype: unknown): metatype is ZodDtoStatic {
  return typeof metatype === 'function' && 'zodSchema' in metatype;
}

/**
 * Replaces the empty placeholders @nestjs/swagger produces for these classes
 * with the real schemas derived from Zod.
 *
 * Without this the document still lists every DTO, but each one is an object
 * with no properties — documentation that looks complete and says nothing.
 */
export function applyZodSchemas(document: OpenAPIObject): OpenAPIObject {
  if (registry.size === 0) {
    return document;
  }

  document.components ??= {};
  document.components.schemas ??= {};

  for (const [name, schema] of registry) {
    document.components.schemas[name] = schema;
  }

  return document;
}
