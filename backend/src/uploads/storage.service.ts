import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { Readable, Writable } from 'stream';
import { v4 as uuidv4 } from 'uuid';

export interface StoredFile {
  storedPath: string;
  url: string;
  filename: string;
  size: number;
}

export interface IStorageAdapter {
  save(stream: Readable, ext: string, tenantId: string, originalname: string): Promise<StoredFile>;
  resolve(storedPath: string): string | null;
  exists(storedPath: string): boolean;
  createReadStream(storedPath: string): Readable;
}

@Injectable()
export class LocalStorageAdapter implements IStorageAdapter {
  private readonly logger = new Logger('LocalStorage');
  private readonly basePath: string;

  constructor() {
    this.basePath = process.env.UPLOAD_DIR || 'uploads';
    fs.mkdirSync(this.basePath, { recursive: true });
  }

  async save(stream: Readable, ext: string, tenantId: string): Promise<StoredFile> {
    const tenantDir = path.join(this.basePath, tenantId);
    fs.mkdirSync(tenantDir, { recursive: true });

    const fileId = uuidv4();
    const filename = fileId + ext;
    const storedPath = path.join(tenantId, filename);
    const fullPath = path.join(this.basePath, storedPath);

    const writeStream = fs.createWriteStream(fullPath);
    let size = 0;

    const counter = new (require('stream').Transform)({
      transform(chunk: Buffer, _encoding: string, callback: Function) {
        size += chunk.length;
        callback(null, chunk);
      },
    });

    await pipeline(stream, counter, writeStream);

    const url = '/api/uploads/' + storedPath;

    return { storedPath, url, filename: storedPath, size };
  }

  resolve(storedPath: string): string | null {
    // Try tenant-namespaced path first
    const fullPath = path.join(this.basePath, storedPath);
    if (fs.existsSync(fullPath)) return fullPath;

    // Fallback: try flat path (legacy files from Go backend)
    const flatPath = path.join(this.basePath, path.basename(storedPath));
    if (fs.existsSync(flatPath)) return flatPath;

    return null;
  }

  exists(storedPath: string): boolean {
    return this.resolve(storedPath) !== null;
  }

  createReadStream(storedPath: string): Readable {
    const resolved = this.resolve(storedPath);
    if (!resolved) throw new Error('File not found');
    return fs.createReadStream(resolved);
  }
}
