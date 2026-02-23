import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';

// Max dimension for resized images
const MAX_IMAGE_WIDTH = 1200;
const MAX_IMAGE_HEIGHT = 1200;
// JPEG quality for optimized images
const JPEG_QUALITY = 82;
const WEBP_QUALITY = 80;

// Extensions that sharp can process
const OPTIMIZABLE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

export interface StoredFile {
  storedPath: string;
  url: string;
  filename: string;
  size: number;
  /** WebP version URL (if generated) */
  thumbnailUrl?: string;
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

    // First, save the raw stream to a temp file
    const tempFilename = fileId + '.tmp' + ext;
    const tempPath = path.join(tenantDir, tempFilename);

    const writeStream = fs.createWriteStream(tempPath);
    let rawSize = 0;

    const counter = new (require('stream').Transform)({
      transform(chunk: Buffer, _encoding: string, callback: Function) {
        rawSize += chunk.length;
        callback(null, chunk);
      },
    });

    await pipeline(stream, counter, writeStream);

    // Optimize image if possible
    if (OPTIMIZABLE_EXTS.has(ext.toLowerCase())) {
      try {
        return await this.optimizeAndSave(tempPath, fileId, tenantId, tenantDir);
      } catch (err) {
        this.logger.warn(`Image optimization failed, saving original: ${err}`);
        // Fall through to save unoptimized version
      }
    }

    // Non-optimizable format or optimization failed — rename temp to final
    const finalFilename = fileId + ext;
    const storedPath = path.join(tenantId, finalFilename);
    const finalPath = path.join(this.basePath, storedPath);
    fs.renameSync(tempPath, finalPath);

    const url = '/api/uploads/' + storedPath;
    return { storedPath, url, filename: storedPath, size: rawSize };
  }

  /**
   * Optimize image: resize to max dimensions and save as WebP + JPEG fallback.
   * Returns the WebP version as primary (smaller file size, better quality).
   */
  private async optimizeAndSave(
    tempPath: string,
    fileId: string,
    tenantId: string,
    tenantDir: string,
  ): Promise<StoredFile> {
    const image = sharp(tempPath);
    const metadata = await image.metadata();

    // Determine if resize is needed
    const needsResize =
      (metadata.width && metadata.width > MAX_IMAGE_WIDTH) ||
      (metadata.height && metadata.height > MAX_IMAGE_HEIGHT);

    let transformer = sharp(tempPath).rotate(); // Auto-rotate based on EXIF

    if (needsResize) {
      transformer = transformer.resize(MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    // Save as WebP (primary — best compression)
    const webpFilename = fileId + '.webp';
    const webpStoredPath = path.join(tenantId, webpFilename);
    const webpFullPath = path.join(tenantDir, webpFilename);

    await transformer
      .webp({ quality: WEBP_QUALITY })
      .toFile(webpFullPath);

    const webpStats = fs.statSync(webpFullPath);

    // Also save JPEG fallback for older browsers
    const jpegFilename = fileId + '.jpg';
    const jpegStoredPath = path.join(tenantId, jpegFilename);
    const jpegFullPath = path.join(tenantDir, jpegFilename);

    await sharp(tempPath)
      .rotate()
      .resize(MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toFile(jpegFullPath);

    // Remove temp file
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Best effort
    }

    const webpUrl = '/api/uploads/' + webpStoredPath;
    const jpegUrl = '/api/uploads/' + jpegStoredPath;

    this.logger.log(
      `Image optimized: ${metadata.width}x${metadata.height} → WebP ${webpStats.size} bytes`,
    );

    return {
      storedPath: webpStoredPath,
      url: webpUrl,
      filename: webpStoredPath,
      size: webpStats.size,
      thumbnailUrl: jpegUrl,
    };
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
