import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

const VALID_KEY = /^[A-Za-z0-9_\-:.]{1,255}$/;

/** Reads and validates the optional `Idempotency-Key` header (e.g. a UUID). */
export const IdempotencyKey = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string | undefined => {
    const value = ctx
      .switchToHttp()
      .getRequest<Request>()
      .get('idempotency-key');
    if (!value) return undefined;
    if (!VALID_KEY.test(value)) {
      throw new BadRequestException(
        'Idempotency-Key must be 1-255 characters of [A-Za-z0-9_-:.]',
      );
    }
    return value;
  },
);
