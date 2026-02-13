import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { extname, join } from 'path';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private s3: S3Client | null = null;
  private bucket: string;
  private endpoint: string;
  private readonly uploadsDir: string;

  constructor(private readonly config: ConfigService) {
    const s3Endpoint = this.config.get('S3_ENDPOINT');
    const accessKey = this.config.get('S3_ACCESS_KEY');
    const secretKey = this.config.get('S3_SECRET_KEY');
    this.bucket = this.config.get('S3_BUCKET', 'zr-auto-pro');
    this.endpoint = s3Endpoint || '';
    this.uploadsDir = join(process.cwd(), 'uploads');

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
        'S3 not configured — using local filesystem for uploads',
      );
    }
  }

  async upload(
    file: Express.Multer.File,
    folder: string = 'products',
  ): Promise<string> {
    const ext = extname(file.originalname).toLowerCase() || '.jpg';
    const filename = `${randomUUID()}${ext}`;
    const key = `${folder}/${filename}`;

    // Try S3 first
    if (this.s3) {
      try {
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
        this.logger.log(`Uploaded to S3: ${url}`);
        return url;
      } catch (error) {
        this.logger.warn(`S3 upload failed, falling back to local: ${error.message}`);
      }
    }

    // Local filesystem fallback
    const dir = join(this.uploadsDir, folder);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    const filePath = join(dir, filename);
    await writeFile(filePath, file.buffer);

    const url = `/api/uploads/files/${folder}/${filename}`;
    this.logger.log(`Uploaded locally: ${url}`);
    return url;
  }

  async delete(fileUrl: string): Promise<void> {
    if (!fileUrl) return;

    try {
      // S3 file
      if (this.s3 && fileUrl.startsWith('http')) {
        const urlParts = fileUrl.split(`/${this.bucket}/`);
        if (urlParts.length < 2) return;
        const key = urlParts[1];

        await this.s3.send(
          new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: key,
          }),
        );
        this.logger.log(`Deleted from S3: ${key}`);
        return;
      }

      // Local file
      if (fileUrl.startsWith('/api/uploads/files/')) {
        const relativePath = fileUrl.replace('/api/uploads/files/', '');
        const filePath = join(this.uploadsDir, relativePath);
        if (existsSync(filePath)) {
          await unlink(filePath);
          this.logger.log(`Deleted local file: ${relativePath}`);
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to delete file: ${fileUrl}`, error);
    }
  }

  getLocalFilePath(relativePath: string): string | null {
    const filePath = join(this.uploadsDir, relativePath);
    if (existsSync(filePath)) {
      return filePath;
    }
    return null;
  }

  isConfigured(): boolean {
    return true; // Always available (local fallback)
  }
}
