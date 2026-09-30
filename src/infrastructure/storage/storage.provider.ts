/** DI token for the active StorageProvider implementation. */
export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

/**
 * Object storage abstraction. Swap S3/MinIO for GCS, Azure Blob, local disk…
 * by adding an implementation and selecting it in StorageModule.
 */
export interface StorageProvider {
  /** Uploads an object and returns its canonical (unsigned) URL. */
  upload(key: string, body: Buffer, contentType: string): Promise<string>;
  /** Short-lived URL that lets a client download a private object. */
  getSignedDownloadUrl(key: string, expiresInSeconds: number): Promise<string>;
}
