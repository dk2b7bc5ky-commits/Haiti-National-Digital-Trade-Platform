import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import type { ApiFailure } from '@rezo/shared-types';

/**
 * Turns any thrown error into the standard Rezo failure envelope (spec §15):
 *   { data: null, error: { code, message } }
 * with an appropriate HTTP status code.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'An unexpected error occurred.';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (res && typeof res === 'object') {
        const r = res as Record<string, unknown>;
        // class-validator returns `message` as a string[] of failures; flatten it.
        message = Array.isArray(r.message) ? (r.message as string[]).join('; ') : (r.message as string) ?? exception.message;
      }
      code = this.statusToCode(status);
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Map the common database errors to sensible HTTP statuses instead of a
      // blanket 500, without leaking column/constraint internals to the client.
      const mapped = this.mapPrismaError(exception);
      status = mapped.status;
      code = mapped.code;
      message = mapped.message;
      this.logger.warn(`Prisma ${exception.code}: ${exception.message}`);
    } else if (exception instanceof Error) {
      // Unknown/unexpected error: log the details server-side, return a generic
      // message so we never leak stack traces or internals to the caller.
      this.logger.error(exception.stack ?? exception.message);
    }

    const body: ApiFailure = { data: null, error: { code, message } };
    response.status(status).json(body);
  }

  private mapPrismaError(e: Prisma.PrismaClientKnownRequestError): { status: number; code: string; message: string } {
    switch (e.code) {
      case 'P2002': // unique constraint violation
        return { status: HttpStatus.CONFLICT, code: 'conflict', message: 'A record with these values already exists.' };
      case 'P2025': // record not found for the operation
        return { status: HttpStatus.NOT_FOUND, code: 'not_found', message: 'The requested record was not found.' };
      case 'P2003': // foreign key constraint failed
        return { status: HttpStatus.BAD_REQUEST, code: 'bad_request', message: 'A referenced record does not exist.' };
      default:
        return { status: HttpStatus.INTERNAL_SERVER_ERROR, code: 'internal_error', message: 'A database error occurred.' };
    }
  }

  private statusToCode(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'bad_request';
      case HttpStatus.UNAUTHORIZED:
        return 'unauthorized';
      case HttpStatus.FORBIDDEN:
        return 'forbidden';
      case HttpStatus.NOT_FOUND:
        return 'not_found';
      case HttpStatus.CONFLICT:
        return 'conflict';
      case HttpStatus.SERVICE_UNAVAILABLE:
        return 'service_unavailable';
      default:
        return 'error';
    }
  }
}
