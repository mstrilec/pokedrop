import { HttpException, type HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@pokedrop/shared';

export function domainError(status: HttpStatus, code: ErrorCode, message: string): HttpException {
  return new HttpException({ message, code }, status);
}
