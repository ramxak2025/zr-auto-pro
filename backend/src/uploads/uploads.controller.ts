import {
  Controller, Post, Get, Req, Res, Param, UseGuards,
  BadRequestException, InternalServerErrorException, Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { LocalStorageAdapter } from './storage.service';
import { Request, Response } from 'express';
import * as Busboy from 'busboy';
import * as path from 'path';

const MAX_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif']);

@Controller('uploads')
export class UploadsController {
  private readonly logger = new Logger('UploadsController');
  private readonly storage: LocalStorageAdapter;

  constructor() {
    this.storage = new LocalStorageAdapter();
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  async upload(
    @Req() req: Request,
    @CurrentUser() user: JwtPayload,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      let resolved = false;
      const done = (err?: Error, result?: any) => {
        if (resolved) return;
        resolved = true;
        if (err) reject(err);
        else resolve(result);
      };

      const busboy = Busboy({
        headers: req.headers,
        limits: { fileSize: MAX_SIZE, files: 1 },
      });

      busboy.on('file', (fieldname: string, stream: any, info: any) => {
        const originalname = info.filename || 'file';
        const ext = path.extname(originalname).toLowerCase();

        if (!ALLOWED_EXTS.has(ext)) {
          stream.resume();
          done(new BadRequestException({ message: 'Неподдерживаемый формат. Используйте JPG, PNG, WebP' }));
          return;
        }

        let truncated = false;
        stream.on('limit', () => { truncated = true; });

        this.storage.save(stream, ext, user.tenantID)
          .then((stored) => {
            if (truncated) {
              done(new BadRequestException({ message: 'Файл слишком большой (макс 10МБ)' }));
              return;
            }
            done(undefined, {
              url: stored.url,
              thumbnail: stored.url,
              filename: stored.filename,
              originalname,
              size: stored.size,
            });
          })
          .catch((err) => {
            this.logger.error(`Upload stream error: ${err}`);
            done(new InternalServerErrorException({ message: 'Ошибка сохранения файла' }));
          });
      });

      busboy.on('error', (err: Error) => {
        this.logger.error(`Busboy error: ${err}`);
        done(new InternalServerErrorException({ message: 'Ошибка загрузки файла' }));
      });

      busboy.on('finish', () => {
        // If no file was received
        if (!resolved) {
          done(new BadRequestException({ message: 'Файл не найден' }));
        }
      });

      req.pipe(busboy);
    });
  }

  @Get('*')
  serve(@Req() req: Request, @Res() res: Response) {
    // Extract the path after /api/uploads/
    const urlPath = req.params[0] || '';
    if (!urlPath) {
      return res.status(404).json({ message: 'Файл не найден' });
    }

    // Prevent directory traversal
    const normalized = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');

    if (!this.storage.exists(normalized)) {
      return res.status(404).json({ message: 'Файл не найден' });
    }

    const ext = path.extname(normalized).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.webp': 'image/webp', '.gif': 'image/gif', '.heic': 'image/heic', '.heif': 'image/heif',
    };

    res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    const readStream = this.storage.createReadStream(normalized);
    readStream.pipe(res);
    readStream.on('error', () => {
      if (!res.headersSent) {
        res.status(500).json({ message: 'Ошибка чтения файла' });
      }
    });
  }
}
