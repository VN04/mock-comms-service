import { Global, Module } from '@nestjs/common';
import { S3StorageProvider } from './s3-storage.provider';
import { STORAGE_PROVIDER } from './storage.provider';

/** Binds STORAGE_PROVIDER to the configured implementation (S3/MinIO today). */
@Global()
@Module({
  providers: [{ provide: STORAGE_PROVIDER, useClass: S3StorageProvider }],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
