import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import type { ApiKeyContext } from '../../common/auth/api-key-context';
import { CurrentApiKey } from '../../common/decorators/auth.decorators';
import {
  CallHistoryResponse,
  CallHistoryService,
} from './call-history.service';

@Controller('calls')
export class CallHistoryController {
  constructor(private readonly history: CallHistoryService) {}

  @Get(':id/events')
  getEvents(
    @CurrentApiKey() apiKey: ApiKeyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CallHistoryResponse> {
    return this.history.getHistory(apiKey, id);
  }
}
