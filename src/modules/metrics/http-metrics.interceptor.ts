import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

/** Records latency per route template (e.g. `/calls/:id`, not the raw URL). */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const start = process.hrtime.bigint();
    const observe = (status: number) =>
      this.metrics.observeHttpRequest(
        req.method,
        (req.route as { path?: string } | undefined)?.path ?? 'unknown',
        status,
        Number(process.hrtime.bigint() - start) / 1e9,
      );

    return next.handle().pipe(
      tap({
        next: () => observe(http.getResponse<Response>().statusCode),
        error: (err: unknown) =>
          observe(err instanceof HttpException ? err.getStatus() : 500),
      }),
    );
  }
}
