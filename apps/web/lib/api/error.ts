// Apart from core.ts, which imports zod: the root providers and error boundaries need
// only this class, and must not put zod in every page's first load.
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
