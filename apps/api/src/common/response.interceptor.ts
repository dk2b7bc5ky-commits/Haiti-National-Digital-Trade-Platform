import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Paginated } from './pagination';

/**
 * Wraps every successful controller return value in the standard Rezo envelope
 * (spec §15):  { data: <value>, error: null }.
 *
 * List endpoints return a Paginated marker; those are emitted as
 * { data: [...items], next_cursor, error: null } so `next_cursor` sits beside
 * `data` per the spec's list convention.
 *
 * Controllers therefore just return their plain payload (or a Paginated); the
 * envelope is applied here in one place so the convention can't be got wrong.
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((value) => {
        if (value instanceof Paginated) {
          return { data: value.items, next_cursor: value.nextCursor, error: null };
        }
        return { data: value, error: null };
      }),
    );
  }
}
