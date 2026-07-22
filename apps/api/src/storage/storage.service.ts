import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand, CreateBucketCommand } from '@aws-sdk/client-s3';

/**
 * Object storage for documents — S3-compatible, MinIO in dev (spec §6). This is
 * our own infrastructure (part of docker-compose), not a third-party API, so it
 * is used for real. `fileRef` returned here is the object key stored on the
 * Document row.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger('StorageService');
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET ?? 'rezo-documents';
    this.client = new S3Client({
      endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
      region: process.env.S3_REGION ?? 'us-east-1',
      forcePathStyle: true, // required for MinIO
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? 'rezo_minio_access',
        secretAccessKey: process.env.S3_SECRET_KEY ?? 'rezo_minio_secret',
      },
    });
  }

  async onModuleInit(): Promise<void> {
    // Ensure the bucket exists (compose also creates it; this is a safety net).
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    } catch {
      // Already exists / owned — fine.
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
    this.logger.log(`Stored ${key} (${body.length} bytes) in ${this.bucket}`);
    return key;
  }

  async getBytes(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
}
