import { Catch, ServiceUnavailableException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Terminus signals a failed check by throwing ServiceUnavailableException whose
 * body *is* the health report — which indicator is down, and why.
 *
 * The global AllExceptionsFilter would reshape that into the standard error
 * envelope and, because 503 is at or above the server-error floor, replace the
 * message with "Internal server error". The one endpoint whose entire purpose
 * is diagnosis would answer with no diagnosis, and with a message that is not
 * even true: the process is fine, a dependency is not.
 *
 * Scoped to the health controller with @UseFilters. Narrower filters win, and
 * because this one only catches ServiceUnavailableException, anything else
 * thrown in that controller still reaches the global filter and still comes
 * back in the documented envelope.
 */
@Catch(ServiceUnavailableException)
export class HealthCheckFilter implements ExceptionFilter {
  catch(exception: ServiceUnavailableException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    response.status(exception.getStatus()).json(exception.getResponse());
  }
}
