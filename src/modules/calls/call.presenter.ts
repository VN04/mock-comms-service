import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CallRecord } from '../../common/call/call-record';
import { RecordingStatus } from '../../common/call/call-status';
import { AppConfig } from '../../config/configuration';
import { STORAGE_PROVIDER } from '../../infrastructure/storage/storage.provider';
import type { StorageProvider } from '../../infrastructure/storage/storage.provider';
import { CallResponse } from './dto/call-response.dto';

const iso = (ms: number | null): string | null =>
  ms === null ? null : new Date(ms).toISOString();

/** Maps a CallRecord to its public JSON shape (REST and WebSocket). */
@Injectable()
export class CallPresenter {
  private readonly signedUrlTtl: number;

  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    config: ConfigService<AppConfig, true>,
  ) {
    this.signedUrlTtl = config.get('storage.signedUrlTtlSeconds', {
      infer: true,
    });
  }

  async present(call: CallRecord): Promise<CallResponse> {
    return {
      call_id: call.id,
      status: call.status,
      outcome: call.outcome,
      from: call.from,
      to: call.to,
      metadata: call.metadata,
      provider: call.provider,
      timestamps: {
        queued_at: new Date(call.queuedAt).toISOString(),
        ringing_at: iso(call.ringingAt),
        answered_at: iso(call.answeredAt),
        unanswered_at: iso(call.unansweredAt),
        completed_at: iso(call.completedAt),
      },
      recording: await this.presentRecording(call),
      last_event_sequence: call.lastSequence,
    };
  }

  private async presentRecording(
    call: CallRecord,
  ): Promise<CallResponse['recording']> {
    if (!call.recordingStatus) return null;
    if (
      call.recordingStatus !== RecordingStatus.UPLOADED ||
      !call.recordingKey
    ) {
      return { status: call.recordingStatus, url: null, url_expires_at: null };
    }
    return {
      status: call.recordingStatus,
      url: await this.storage.getSignedDownloadUrl(
        call.recordingKey,
        this.signedUrlTtl,
      ),
      url_expires_at: new Date(
        Date.now() + this.signedUrlTtl * 1000,
      ).toISOString(),
    };
  }
}
