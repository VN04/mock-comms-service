import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * Normalizes every error to `{ "error": string, "details"?: [...] }`,
 * e.g. `{ "error": "Rate limit exceeded" }` for 429s as the spec requires.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (!(exception instanceof HttpException)) {
      this.logger.error(
        exception instanceof Error ? exception.stack : exception,
      );
      res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .json({ error: 'Internal server error' });
      return;
    }

    const status = exception.getStatus();
    const body = exception.getResponse();
    const message =
      typeof body === 'string'
        ? body
        : (body as { message?: string | string[] }).message;

    // ValidationPipe reports a list of messages.
    if (Array.isArray(message)) {
      res.status(status).json({ error: 'Validation failed', details: message });
      return;
    }
    res.status(status).json({ error: message ?? exception.message });
  }
}
