import { randomUUID } from 'node:crypto';
import type { Params } from 'nestjs-pino';
import type { AppConfig } from '../config/index.js';

const LIVENESS_PATH = '/api/v1/health/live';

const CLIENT_ERROR_FLOOR = 400;
const SERVER_ERROR_FLOOR = 500;

// An allowlist, not a denylist: the default pino-http serializer logs every
// header, so any future bearer-style header would be logged in full from the
// day it is introduced.
const LOGGED_REQUEST_HEADERS = [
  'user-agent',
  'referer',
  'content-type',
  'content-length',
  'x-request-id',
] as const;

export function buildLoggerOptions(config: AppConfig): Params {
  return {
    pinoHttp: {
      level: config.logging.level,

      genReqId: (request) => {
        const { id } = request as { id?: string };
        return id ?? randomUUID();
      },

      autoLogging: {
        ignore: (request) => (request.url ?? '').split('?')[0] === LIVENESS_PATH,
      },

      // Without this, pino-http writes every completion line at `info` - a 500
      // would be recorded at the level of a successful read, and an alert on
      // level >= error would never fire.
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

          url: request.url,
          headers: pick(request.headers, LOGGED_REQUEST_HEADERS),
        }),

        res: (response: { statusCode?: number }) => ({
          statusCode: response.statusCode,
        }),
      },

      // Defence in depth. The serializers above already drop these, but a later
      // change to them should not silently re-expose a session cookie.
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
