import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { extname } from 'path';

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private s3: S3Client | null = null;
  private bucket: string;
  private endpoint: string;

  constructor(private readonly config: ConfigService) {
    const s3Endpoint = this.config.get('S3_ENDPOINT');
    const accessKey = this.config.get('S3_ACCESS_KEY');
    const secretKey = this.config.get('S3_SECRET_KEY');
    this.bucket = this.config.get('S3_BUCKET', 'zr-auto-pro');
    this.endpoint = s3Endpoint || '';

    if (s3Endpoint && accessKey && secretKey) {
      this.s3 = new S3Client({
        endpoint: s3Endpoint,
        region: this.config.get('S3_REGION', 'ru-1'),
        credentials: {
          accessKeyId: accessKey,
          secretAccessKey: secretKey,
        },
        forcePathStyle: true,
      });
      this.logger.log(`S3 storage configured: ${s3Endpoint}/${this.bucket}`);
    } else {
      this.logger.warn(
        'S3 not configured — file uploads will not be available. Set S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY in .env',
      );
    }
  }

  async upload(
    file: Express.Multer.File,
    folder: string = 'products',
  ): Promise<string> {
    if (!this.s3) {
      throw new Error(
        'S3 storage is not configured. Set S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY in .env',
      );
    }

    const ext = extname(file.originalname).toLowerCase() || '.jpg';
    const key = `${folder}/${randomUUID()}${ext}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: 'public-read',
      }),
    );

    const url = `${this.endpoint}/${this.bucket}/${key}`;
    this.logger.log(`Uploaded file: ${url}`);
    return url;
  }

  async delete(fileUrl: string): Promise<void> {
    if (!this.s3 || !fileUrl) return;

    try {
      const urlParts = fileUrl.split(`/${this.bucket}/`);
      if (urlParts.length < 2) return;
      const key = urlParts[1];

      await this.s3.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      this.logger.log(`Deleted file: ${key}`);
    } catch (error) {
      this.logger.warn(`Failed to delete file: ${fileUrl}`, error);
    }
  }

  isConfigured(): boolean {
    return this.s3 !== null;
  }
}
