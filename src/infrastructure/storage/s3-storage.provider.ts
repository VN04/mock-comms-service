import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { StorageProvider } from './storage.provider';

/**
 * S3-compatible storage: AWS S3 in production, MinIO locally.
 *
 * Two clients: uploads go to the internal endpoint (e.g. http://minio:9000
 * inside Docker), while signed URLs are generated against the PUBLIC endpoint
 * (e.g. http://localhost:9000) so the links work from the client's machine.
 * Signing is a local computation, so the public client never makes requests.
 */
@Injectable()
export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly signingClient: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(config: ConfigService<AppConfig, true>) {
    const cfg = config.get('storage', { infer: true });
    this.bucket = cfg.bucket;

    const base: S3ClientConfig = {
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle,
      credentials:
        cfg.accessKeyId && cfg.secretAccessKey
          ? {
              accessKeyId: cfg.accessKeyId,
              secretAccessKey: cfg.secretAccessKey,
            }
          : undefined, // fall back to the AWS default chain (IAM role, env…)
    };
    const publicEndpoint = cfg.publicEndpoint ?? cfg.endpoint;
    this.client = new S3Client({ ...base, endpoint: cfg.endpoint });
    this.signingClient = new S3Client({ ...base, endpoint: publicEndpoint });

    this.publicBaseUrl = publicEndpoint
      ? `${publicEndpoint.replace(/\/$/, '')}/${cfg.bucket}`
      : `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com`;
  }

  async upload(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return `${this.publicBaseUrl}/${key}`;
  }

  getSignedDownloadUrl(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      this.signingClient,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }
}
