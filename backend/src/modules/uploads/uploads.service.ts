import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class UploadsService {
  private s3Client: S3Client | null = null;
  private bucket: string;

  constructor(private readonly configService: ConfigService) {
    const endpoint = this.configService.get<string>('S3_ENDPOINT');
    if (endpoint) {
      this.s3Client = new S3Client({
        endpoint,
        region: this.configService.get<string>('S3_REGION', 'us-east-1'),
        credentials: {
          accessKeyId: this.configService.get<string>('S3_ACCESS_KEY', ''),
          secretAccessKey: this.configService.get<string>('S3_SECRET_KEY', ''),
        },
        forcePathStyle: true,
      });
      this.bucket = this.configService.get<string>('S3_BUCKET', 'uploads');
    }
  }

  async upload(file: Express.Multer.File): Promise<string> {
    const ext = path.extname(file.originalname);
    const filename = `${uuidv4()}${ext}`;

    if (this.s3Client) {
      return this.uploadToS3(file, filename);
    }

    return this.uploadLocally(file, filename);
  }

  private async uploadToS3(
    file: Express.Multer.File,
    filename: string,
  ): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: filename,
        Body: file.buffer,
        ContentType: file.mimetype,
      });

      await this.s3Client!.send(command);

      const endpoint = this.configService.get<string>('S3_ENDPOINT');
      return `${endpoint}/${this.bucket}/${filename}`;
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to upload file to S3: ${error.message}`,
      );
    }
  }

  private async uploadLocally(
    file: Express.Multer.File,
    filename: string,
  ): Promise<string> {
    const uploadsDir = path.resolve(process.cwd(), 'uploads');

    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const filePath = path.join(uploadsDir, filename);
    fs.writeFileSync(filePath, file.buffer);

    return `/api/uploads/${filename}`;
  }
}
