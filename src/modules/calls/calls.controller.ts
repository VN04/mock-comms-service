import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { ApiKeyContext } from '../../common/auth/api-key-context';
import { CurrentApiKey } from '../../common/decorators/auth.decorators';
import { resolvePublicBaseUrl } from '../../common/utils/public-base-url';
import { AppConfig } from '../../config/configuration';
import { CallsService } from './calls.service';
import {
  CallResponse,
  CreateCallResponse,
  WsTokenResponse,
} from './dto/call-response.dto';
import { CreateCallDto } from './dto/create-call.dto';
import { IdempotencyKey } from './idempotency-key.decorator';

@Controller('calls')
export class CallsController {
  private readonly publicBaseUrl?: string;

  constructor(
    private readonly calls: CallsService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.publicBaseUrl = config.get('app.publicBaseUrl', { infer: true });
  }

  /**
   * Starts a call. 201 with call_id + ws_url; 429 when a limit is hit.
   * With `Idempotency-Key`, a retry returns the original call (200 + header).
   */
  @Post()
  async create(
    @CurrentApiKey() apiKey: ApiKeyContext,
    @Body() dto: CreateCallDto,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CreateCallResponse> {
    const { response, replayed } = await this.calls.create(apiKey, dto, {
      idempotencyKey,
      baseUrl: resolvePublicBaseUrl(req, this.publicBaseUrl),
    });
    res.status(replayed ? HttpStatus.OK : HttpStatus.CREATED);
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    return response;
  }

  @Get(':id')
  get(
    @CurrentApiKey() apiKey: ApiKeyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CallResponse> {
    return this.calls.get(apiKey, id);
  }

  /** Issues a fresh WebSocket URL for an existing call (reconnects). */
  @Post(':id/ws-token')
  @HttpCode(HttpStatus.CREATED)
  issueWsToken(
    @CurrentApiKey() apiKey: ApiKeyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<WsTokenResponse> {
    return this.calls.issueWsToken(
      apiKey,
      id,
      resolvePublicBaseUrl(req, this.publicBaseUrl),
    );
  }
}
