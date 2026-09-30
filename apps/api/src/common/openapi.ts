import { HttpStatus, SetMetadata, type INestApplication } from '@nestjs/common';
import { PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum.js';
import { ModulesContainer, Reflector } from '@nestjs/core';
import type { OpenAPIObject } from '@nestjs/swagger';
import { ErrorEnvelopeSchema } from '@pokedrop/shared';
import { z, type ZodType } from 'zod';
import { Public } from './decorators/public.decorator.js';
import { Roles } from './decorators/roles.decorator.js';
import { isZodDto } from './zod-dto.js';

const DOC_METADATA = 'pokedrop:openapi-doc';

export const SESSION_SCHEME = 'session';
export const SESSION_COOKIE = 'better-auth.session_token';

type DocResult = { name: string; schema: ZodType };
type DocMeta = { summary: string; result: DocResult | string | null };

/**
 * The one annotation every route carries: what it does, and what a success
 * returns — a named shared schema, a description for a body no schema covers,
 * or nothing. Authentication, roles, query parameters and errors are derived
 * from the route's own metadata by `applyOpenApiConventions`, so they cannot
 * drift from what the guards actually enforce.
 */
export const Doc = (summary: string, result: DocResult | string | null = null) =>
  SetMetadata(DOC_METADATA, { summary, result } satisfies DocMeta);

export const returns = (name: string, schema: ZodType): DocResult => ({ name, schema });

type RouteMeta = {
  doc: DocMeta | undefined;
  isPublic: boolean;
  roles: readonly string[];
  query: ZodType | null;
};

type Operation = {
  operationId?: string;
  summary?: string;
  parameters?: Record<string, unknown>[];
  responses: Record<string, Record<string, unknown>>;
  security?: Record<string, string[]>[];
  requestBody?: unknown;
  [extension: `x-${string}`]: unknown;
};

const STATUS_TEXT: Record<string, string> = {
  [HttpStatus.OK]: 'OK',
  [HttpStatus.CREATED]: 'Created',
  [HttpStatus.ACCEPTED]: 'Accepted',
  [HttpStatus.NO_CONTENT]: 'No content',
};

/**
 * Output, not input: a response schema describes what the API sends, so
 * `z.coerce.date()` is a date-time string rather than "anything coercible".
 */
function outputJsonSchema(schema: ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, {
    io: 'output',
    unrepresentable: 'any',
    override: (ctx) => {
      if ((ctx.zodSchema as { _zod: { def: { type: string } } })._zod.def.type === 'date') {
        ctx.jsonSchema.type = 'string';
        ctx.jsonSchema.format = 'date-time';
      }
    },
  }) as Record<string, unknown>;
  delete json['$schema'];
  return json;
}

function routeMetadata(app: INestApplication): Map<string, RouteMeta> {
  const reflector = app.get(Reflector);
  const routes = new Map<string, RouteMeta>();

  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: never[]) => object) | null;
      if (!controller) {
        continue;
      }
      const prototype = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[name];
        if (name === 'constructor' || typeof handler !== 'function') {
          continue;
        }
        if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) {
          continue;
        }
        routes.set(`${controller.name}_${name}`, {
          doc: reflector.get<DocMeta | undefined>(DOC_METADATA, handler),
          isPublic: reflector.getAllAndOverride(Public, [handler, controller]) !== undefined,
          roles: reflector.getAllAndOverride(Roles, [handler, controller]) ?? [],
          query: queryDtoOf(prototype, name),
        });
      }
    }
  }
  return routes;
}

function queryDtoOf(prototype: object, name: string): ZodType | null {
  const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, prototype.constructor, name) ??
    {}) as Record<string, { index: number }>;
  const types = (Reflect.getMetadata('design:paramtypes', prototype, name) ?? []) as unknown[];
  for (const [key, arg] of Object.entries(args)) {
    if (key.split(':')[0] === String(RouteParamtypes.QUERY)) {
      const type = types[arg.index];
      if (isZodDto(type)) {
        return type.zodSchema;
      }
    }
  }
  return null;
}

function queryParameters(schema: ZodType): Record<string, unknown>[] {
  const json = z.toJSONSchema(schema, { io: 'input' }) as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  return Object.entries(json.properties ?? {}).map(([name, property]) => ({
    name,
    in: 'query',
    required: json.required?.includes(name) ?? false,
    ...(typeof property['description'] === 'string'
      ? { description: property['description'] }
      : {}),
    schema: property,
  }));
}

/**
 * Everything the routes' own metadata already says, written into the
 * document: security from @Public, the admin mark from @Roles, query
 * parameters from the @Query DTO, one shared error response, and each
 * route's @Doc. A route without @Doc, or an operation no handler explains,
 * stops the boot - an incomplete reference fails loudly rather than shipping.
 */
export function applyOpenApiConventions(
  document: OpenAPIObject,
  app: INestApplication,
): OpenAPIObject {
  const routes = routeMetadata(app);
  const schemas = (document.components ??= {}).schemas ?? {};
  document.components.schemas = schemas;
  const registered = new Map<string, ZodType>();

  const register = (name: string, schema: ZodType): string => {
    const known = registered.get(name);
    if (known !== undefined && known !== schema) {
      throw new Error(`Two response schemas are both named "${name}"`);
    }
    if (known === undefined && name in schemas) {
      throw new Error(`Response schema "${name}" collides with a request schema of the same name`);
    }
    registered.set(name, schema);
    schemas[name] = outputJsonSchema(schema);
    return `#/components/schemas/${name}`;
  };

  document.components.responses = {
    ...document.components.responses,
    Error: {
      description:
        'The standard error envelope. `code` is present only on domain errors a client is expected to act on — see docs/API.md, "Standard error envelope".',
      content: {
        'application/json': { schema: { $ref: register('ErrorEnvelope', ErrorEnvelopeSchema) } },
      },
    },
  };
  const error = { $ref: '#/components/responses/Error' };

  for (const [path, item] of Object.entries(document.paths)) {
    for (const [method, value] of Object.entries(item)) {
      const operation = value as Operation;
      const key = (operation.operationId ?? '').replace(/_v\d+$/, '');
      const route = routes.get(key);
      if (route === undefined) {
        throw new Error(`OpenAPI: no handler found for ${method.toUpperCase()} ${path} (${key})`);
      }
      if (route.doc === undefined) {
        throw new Error(`OpenAPI: ${key} has no @Doc() summary`);
      }

      const admin = route.roles.includes('ADMIN');
      operation.summary = admin ? `[Admin] ${route.doc.summary}` : route.doc.summary;
      if (admin) {
        operation['x-roles'] = [...route.roles];
      }

      const [status, success] = Object.entries(operation.responses).find(([code]) =>
        code.startsWith('2'),
      ) ?? ['200', {}];
      const result = route.doc.result;
      operation.responses[status] = {
        ...success,
        description:
          typeof result === 'string' ? result : (STATUS_TEXT[status] ?? `HTTP ${status}`),
        ...(result !== null && typeof result !== 'string'
          ? {
              content: {
                'application/json': { schema: { $ref: register(result.name, result.schema) } },
              },
            }
          : {}),
      };

      if (route.query !== null) {
        const inPath = (operation.parameters ?? []).filter(
          (parameter) => parameter['in'] !== 'query',
        );
        operation.parameters = [...inPath, ...queryParameters(route.query)];
      }

      operation.security = route.isPublic ? [] : [{ [SESSION_SCHEME]: [] }];
      if (!route.isPublic) {
        operation.responses['401'] = error;
      }
      if (route.roles.length > 0) {
        operation.responses['403'] = error;
      }
      operation.responses['default'] = error;
    }
  }

  return document;
}
