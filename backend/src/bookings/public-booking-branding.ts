import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs, existsSync } from 'fs';
import * as path from 'path';
import { Request } from 'express';
import * as Busboy from 'busboy';
import sharp = require('sharp');

export const BOOKING_BRANDING_MAX_BYTES = 5 * 1024 * 1024;
const MAX_PIXELS = 24_000_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const invalid = () => new BadRequestException({ message: 'Выберите JPEG, PNG или WebP до 5 МБ и 24 мегапикселей' });
function scopePath(tenant: string, point: string | null) {
  if (!UUID.test(tenant) || (point !== null && !UUID.test(point))) throw invalid();
  return `public-booking-branding/${tenant}/${point ?? 'tenant'}/`;
}
/** Exact server namespace and existing re-encoded asset. No URL normalization,
 * arbitrary hosts, encoded separators, private uploads or another branch. */
export function validateBookingBrandingUrl(value: string | null | undefined, tenant: string, point: string | null) {
  if (value === undefined || value === null) return value;
  const prefix = `/api/uploads/${scopePath(tenant, point)}`;
  const filename = value.startsWith(prefix) ? value.slice(prefix.length) : '';
  if (!/^[a-f0-9-]{36}\.webp$/.test(filename) || !UUID.test(filename.slice(0, -5))) throw invalid();
  if (!existsSync(path.join(process.env.UPLOAD_DIR || 'uploads', scopePath(tenant, point), filename))) throw invalid();
  return value;
}
/** Decode only supported raster bytes, bound decompression, strip metadata and
 * re-encode. A decoder failure never exposes the original file. */
export async function encodeBookingBranding(bytes: Buffer): Promise<Buffer> {
  if (!bytes.length || bytes.length > BOOKING_BRANDING_MAX_BYTES) throw invalid();
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!jpeg && !png && !webp) throw invalid();
  try {
    const image = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: 'warning' });
    const metadata = await image.metadata();
    if (
      !['jpeg', 'png', 'webp'].includes(metadata.format ?? '') ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > 10000 ||
      metadata.height > 10000 ||
      metadata.width * metadata.height > MAX_PIXELS ||
      (metadata.pages ?? 1) !== 1
    )
      throw invalid();
    return await image
      .rotate()
      .resize({ width: 1800, height: 1200, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    throw invalid();
  }
}

export function readBookingBranding(req: Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let bytes: Buffer | undefined;
    let failed = false;
    const fail = () => {
      failed = true;
      reject(invalid());
    };
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: { fileSize: BOOKING_BRANDING_MAX_BYTES, files: 1, fields: 0, parts: 2 },
      });
    } catch {
      fail();
      return;
    }
    parser.on('file', (field, stream) => {
      if (field !== 'file') {
        stream.resume();
        fail();
        return;
      }
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => {
        if (!failed) chunks.push(chunk);
      });
      stream.on('limit', fail);
      stream.on('error', fail);
      stream.on('end', () => {
        if (!failed) bytes = Buffer.concat(chunks);
      });
    });
    parser.on('filesLimit', fail);
    parser.on('partsLimit', fail);
    parser.on('fieldsLimit', fail);
    parser.on('error', fail);
    req.on('aborted', fail);
    parser.on('close', () => {
      req.off('aborted', fail);
      if (!failed && bytes) resolve(bytes);
      else if (!failed) fail();
    });
    req.pipe(parser);
  });
}

@Injectable()
export class PublicBookingBrandingStorage {
  async save(bytes: Buffer, tenant: string, point: string | null) {
    const encoded = await encodeBookingBranding(bytes);
    const folder = scopePath(tenant, point);
    const directory = path.resolve(process.env.UPLOAD_DIR || 'uploads', folder);
    await fs.mkdir(directory, { recursive: true });
    const filename = `${randomUUID()}.webp`;
    await fs.writeFile(path.join(directory, filename), encoded, { flag: 'wx' });
    return { url: `/api/uploads/${folder}${filename}` };
  }
}
