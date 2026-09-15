import { randomUUID } from 'node:crypto';
import type { Params } from 'nestjs-pino';
import type { AppConfig } from '../config/index.js';

/**
 * Request headers worth keeping. An allowlist rather than a denylist: the
 * default pino-http serializer logs every header, which means any future
 * bearer-style header nobody thought to redact would be logged in full from
 * the day it is introduced.
 */
const CLIENT_ERROR_FLOOR = 400;
const SERVER_ERROR_FLOOR = 500;

const LOGGED_REQUEST_HEADERS = [
  'user-agent',
  'referer',
  'content-type',
  'content-length',
  'x-request-id',
] as const;

/**
 * One source of pino configuration.
 *
 * The BullMQ worker in PD-41 is a second entrypoint into this same codebase,
 * and it imports this function rather than repeating any of it — that is what
 * makes "worker and API share the logger configuration" true by construction
 * instead of by discipline.
 */
export function buildLoggerOptions(config: AppConfig): Params {
  return {
    pinoHttp: {
      level: config.logging.level,

      // Adopt the id the request-id middleware already put on the request.
      // Letting pino generate its own would put a different id in the log from
      // the one in the error envelope and the X-Request-Id header, which is the
      // exact failure PD-18 existed to fix.
      genReqId: (request) => {
        const { id } = request as { id?: string };
        return id ?? randomUUID();
      },

      // Without this every completion line is written at `useLevel`, which
      // defaults to info — a 500 would be logged at the same level as a
      // successful read, and no alert on level >= error would ever fire.
      customLogLevel: (_request, response, error) => {
        if (error || response.statusCode >= SERVER_ERROR_FLOOR) {
          return 'error';
        }

        return response.statusCode >= CLIENT_ERROR_FLOOR ? 'warn' : 'info';
      },

      serializers: {
        req: (request: {
          id?: unknown;
          method?: string;
          url?: string;
          headers?: Record<string, unknown>;
        }) => ({
          id: request.id,
          method: request.method,
          // Carries the query string, which is worth having for catalog
          // searches. Nothing secret travels in a query string today; anything
          // token-bearing added later needs redacting here first.
          url: request.url,
          headers: pick(request.headers, LOGGED_REQUEST_HEADERS),
        }),

        // Status only. The default serializer includes response headers, and
        // Set-Cookie on a sign-in response is a session handed to anyone who
        // can read the log.
        res: (response: { statusCode?: number }) => ({
          statusCode: response.statusCode,
        }),
      },

      // Defence in depth. The serializers above already drop these, but a later
      // change to them should not silently re-expose anything.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["proxy-authorization"]',
          'req.headers["x-api-key"]',
          'res.headers["set-cookie"]',
        ],
        censor: '[redacted]',
      },

      // pino-pretty is a devDependency: production emits JSON and never loads
      // it.
      transport: config.app.isProduction
        ? undefined
        : {
            target: 'pino-pretty',
            options: {
              colorize: true,
              singleLine: true,
              translateTime: 'SYS:HH:MM:ss.l',
              ignore: 'pid,hostname',
            },
          },
    },
  };
}

function pick(
  source: Record<string, unknown> | undefined,
  keys: readonly string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (!source) {
    return result;
  }

  for (const key of keys) {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }

  return result;
}
