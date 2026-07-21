import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { ApiSuccess } from '@rezo/shared-types';

/**
 * Wraps every successful controller return value in the standard Rezo envelope
 * (spec §15):  { data: <value>, error: null }.
 *
 * Controllers therefore just return their plain payload; the envelope is applied
 * here in one place so the convention is impossible to get wrong per-endpoint.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiSuccess<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccess<T>> {
    return next.handle().pipe(map((data) => ({ data, error: null })));
  }
}
