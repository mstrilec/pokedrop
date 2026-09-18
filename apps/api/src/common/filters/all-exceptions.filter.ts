import { randomUUID } from 'node:crypto';
import { Catch } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { SERVER_ERROR_FLOOR, buildErrorEnvelope } from '../errors/error-envelope.js';
import { getRequestId } from '../request-id.js';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(AllExceptionsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();

    const requestId = getRequestId(http.getRequest<Request>()) ?? randomUUID();

    const envelope = buildErrorEnvelope(exception, requestId);

    if (envelope.statusCode >= SERVER_ERROR_FLOOR) {
      this.logger.error({ requestId, err: exception }, 'Request failed');
    }

    response.status(envelope.statusCode).json(envelope);
  }
}
