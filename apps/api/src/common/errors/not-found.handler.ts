import { randomUUID } from 'node:crypto';
import { HttpStatus, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { getRequestId } from '../request-id.js';
import { buildErrorEnvelope } from './error-envelope.js';

export function notFoundHandler(request: Request, response: Response): void {
  const requestId = getRequestId(request) ?? randomUUID();
  const envelope = buildErrorEnvelope(new NotFoundException('Route not found'), requestId);

  response.status(HttpStatus.NOT_FOUND).json(envelope);
}
