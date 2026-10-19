import { z } from 'zod';
import type { OpenAPIObject } from '@nestjs/swagger';

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

  const jsonSchema = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;

  delete jsonSchema['$schema'];

  registry.set(name, jsonSchema);

  return ZodDto as unknown as ZodDtoStatic<T>;
}

export function isZodDto(metatype: unknown): metatype is ZodDtoStatic {
  return typeof metatype === 'function' && 'zodSchema' in metatype;
}

export function applyZodSchemas(document: OpenAPIObject): OpenAPIObject {
  if (registry.size === 0) {
    return document;
  }

  document.components ??= {};
  document.components.schemas ??= {};

  for (const [name, schema] of registry) {
    document.components.schemas[name] = schema;
  }

  const renames = [...registry.keys()].filter(
    (name) => `${name}Dto` in document.components!.schemas!,
  );
  if (renames.length > 0) {
    let paths = JSON.stringify(document.paths);
    for (const name of renames) {
      paths = paths.replaceAll(
        `"#/components/schemas/${name}Dto"`,
        `"#/components/schemas/${name}"`,
      );
      delete document.components.schemas[`${name}Dto`];
    }
    document.paths = JSON.parse(paths) as OpenAPIObject['paths'];
  }

  return document;
}
