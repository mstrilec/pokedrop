import { ErrorEnvelopeSchema } from '@pokedrop/shared';
import { z } from 'zod';

export type ApiErrorKind = 'api' | 'auth' | 'network' | 'contract';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly statusCode: number;
  readonly code?: string;
  readonly requestId?: string;

  constructor(init: {
    kind: ApiErrorKind;
    statusCode: number;
    message: string;
    code?: string;
    requestId?: string;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.statusCode = init.statusCode;
    this.code = init.code;
    this.requestId = init.requestId;
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export type Query = Record<string, unknown>;

export interface ApiRequest<S extends z.ZodType> {
  method: HttpMethod;
  path: string;
  response: S;
  query?: Query;
  body?: unknown;
}

export const get = <S extends z.ZodType>(
  path: string,
  response: S,
  query?: Query,
): ApiRequest<S> => ({
  method: 'GET',
  path,
  response,
  query,
});

export const post = <S extends z.ZodType>(
  path: string,
  response: S,
  body?: unknown,
): ApiRequest<S> => ({
  method: 'POST',
  path,
  response,
  body,
});

export const patch = <S extends z.ZodType>(
  path: string,
  response: S,
  body?: unknown,
): ApiRequest<S> => ({
  method: 'PATCH',
  path,
  response,
  body,
});

export const del = <S extends z.ZodType>(path: string, response: S): ApiRequest<S> => ({
  method: 'DELETE',
  path,
  response,
});

export interface Transport {
  baseUrl: string;
  headers: () => Record<string, string> | Promise<Record<string, string>>;
  init?: RequestInit;
}

const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const RETRY_DELAY_MS = 300;

const AuthErrorSchema = z.object({ message: z.string(), code: z.string() });

export function createClient(transport: Transport) {
  async function call<S extends z.ZodType>(request: ApiRequest<S>): Promise<z.output<S>> {
    const headers = new Headers(await transport.headers());
    const init: RequestInit = { ...transport.init, method: request.method, headers };
    if (request.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      init.body = JSON.stringify(request.body);
    }
    const url = `${transport.baseUrl}${request.path}${searchOf(request.query)}`;
    const response = await send(url, init, request.method === 'GET' ? 1 : 0);
    return parse(response, request.response);
  }

  return { call };
}

async function send(url: string, init: RequestInit, retries: number): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (retries > 0) return delay().then(() => send(url, unmemoized(init), retries - 1));
    throw new ApiError({
      kind: 'network',
      statusCode: 0,
      message: error instanceof Error ? error.message : 'Network request failed',
    });
  }
  if (retries > 0 && RETRYABLE_STATUSES.has(response.status)) {
    return delay().then(() => send(url, unmemoized(init), retries - 1));
  }
  return response;
}

async function parse<S extends z.ZodType>(response: Response, schema: S): Promise<z.output<S>> {
  const requestId = response.headers.get('x-request-id') ?? undefined;
  const text = await response.text();
  const body = text === '' ? undefined : jsonOrText(text);

  if (!response.ok) throw errorOf(response.status, body, requestId);

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError({
      kind: 'contract',
      statusCode: response.status,
      message: `Response did not match its contract: ${z.prettifyError(parsed.error)}`,
      requestId,
    });
  }
  return parsed.data;
}

function errorOf(status: number, body: unknown, requestId: string | undefined): ApiError {
  const envelope = ErrorEnvelopeSchema.safeParse(body);
  if (envelope.success) {
    return new ApiError({
      kind: 'api',
      statusCode: envelope.data.statusCode,
      message: envelope.data.message,
      code: envelope.data.code,
      requestId: envelope.data.requestId,
    });
  }
  const auth = AuthErrorSchema.safeParse(body);
  if (auth.success) {
    return new ApiError({
      kind: 'auth',
      statusCode: status,
      message: auth.data.message,
      code: auth.data.code,
      requestId,
    });
  }
  return new ApiError({
    kind: 'api',
    statusCode: status,
    message: `Request failed with status ${status}`,
    requestId,
  });
}

function searchOf(query: Query | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === undefined || item === null) continue;
      params.append(key, item instanceof Date ? item.toISOString() : String(item));
    }
  }
  const search = params.toString();
  return search === '' ? '' : `?${search}`;
}

function jsonOrText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
}

// Next memoizes identical GETs within a server render, so a retry without its
// own signal would be handed the failed first answer instead of a new request.
function unmemoized(init: RequestInit): RequestInit {
  return { ...init, signal: new AbortController().signal };
}
