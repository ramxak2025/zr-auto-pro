import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import * as Busboy from 'busboy';
import * as path from 'path';
import { EmployeesService } from './employees.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { LocalStorageAdapter } from '../uploads/storage.service';

const MAX_SIZE = 10 * 1024 * 1024;
const ALLOWED_PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
const ALLOWED_DOC_EXTS = new Set(['.jpg', '.jpeg', '.png', '.pdf', '.webp', '.heic', '.heif']);

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('employees')
export class EmployeesController {
  private readonly logger = new Logger('EmployeesController');

  constructor(
    private employees: EmployeesService,
    private storage: LocalStorageAdapter,
  ) {}

  // Update an employee — see service for permission split.
  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() body: Record<string, unknown>) {
    return this.employees.update(user.userID, user.role, user.tenantID, id, body);
  }

  // Multipart photo upload — saves a 512×512 WebP under uploads/<tenant>/employees/.
  @Post(':id/photo')
  uploadPhoto(@Param('id') id: string, @Req() req: Request, @CurrentUser() user: JwtPayload): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let resolved = false;
      let fileReceived = false;
      const done = (err?: Error, result?: unknown) => {
        if (resolved) return;
        resolved = true;
        if (err) reject(err);
        else resolve(result);
      };

      let busboy: any;
      try {
        busboy = Busboy({ headers: req.headers, limits: { fileSize: MAX_SIZE, files: 1 } });
      } catch (err) {
        done(new BadRequestException({ message: 'Неверный формат запроса' }));
        return;
      }

      busboy.on('file', (_field: string, stream: any, info: any) => {
        fileReceived = true;
        const originalname = info.filename || 'photo';
        const ext = path.extname(originalname).toLowerCase();
        if (!ALLOWED_PHOTO_EXTS.has(ext)) {
          stream.resume();
          done(new BadRequestException({ message: 'Неподдерживаемый формат фото' }));
          return;
        }
        let truncated = false;
        stream.on('limit', () => {
          truncated = true;
        });

        this.employees
          .uploadPhoto(user.userID, user.role, user.tenantID, id, stream, ext)
          .then((res) => {
            if (truncated) {
              done(new BadRequestException({ message: 'Файл слишком большой' }));
              return;
            }
            done(undefined, res);
          })
          .catch((err) => {
            this.logger.error(`Employee photo upload error: ${err}`);
            done(new InternalServerErrorException({ message: 'Ошибка сохранения файла' }));
          });
      });

      busboy.on('error', () => done(new InternalServerErrorException({ message: 'Ошибка загрузки' })));
      busboy.on('close', () => {
        if (!fileReceived && !resolved) done(new BadRequestException({ message: 'Файл не найден' }));
      });
      req.pipe(busboy);
    });
  }

  // `?include=heatmap,timeline` opts into the two heavy aggregates (365-day
  // heatmap + career timeline). Omitting it returns the LIGHT profile — the
  // default for all current clients — which skips that server work.
  @Get(':id/full-profile')
  fullProfile(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Query('include') include?: string) {
    return this.employees.fullProfile(user.tenantID, id, include);
  }

  // ── Documents ──────────────────────────────────────────────────────────

  @Get(':id/documents')
  listDocuments(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.employees.listDocuments(user.tenantID, id);
  }

  /**
   * Authenticated, tenant-scoped document download. Documents live in the
   * PRIVATE uploads subtree which nginx and the public uploads route both
   * refuse to serve — this endpoint is the ONLY way to read them, and it
   * checks the document belongs to the caller's tenant first.
   */
  @Get(':id/documents/:docId/file')
  async serveDocument(
    @Param('id') id: string,
    @Param('docId') docId: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const storedPath = await this.employees.getDocumentStoredPath(user.tenantID, id, docId);

    // Defense-in-depth: stay inside the uploads base dir.
    const normalized = path.normalize(storedPath);
    const fullPath = path.resolve(this.storage.getBasePath(), normalized);
    if (!fullPath.startsWith(this.storage.getBasePath()) || normalized.includes('..')) {
      throw new NotFoundException({ message: 'Документ не найден' });
    }
    if (!this.storage.exists(normalized)) {
      throw new NotFoundException({ message: 'Документ не найден' });
    }

    const ext = path.extname(normalized).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      '.heic': 'image/heic',
      '.heif': 'image/heif',
    };
    res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
    // Sensitive content: no shared caches, no persistence.
    res.setHeader('Cache-Control', 'private, no-store');

    const readStream = this.storage.createReadStream(normalized);
    readStream.pipe(res);
    readStream.on('error', () => {
      if (!res.headersSent) {
        res.status(500).json({ message: 'Ошибка чтения файла' });
      }
    });
  }

  @Roles('director', 'admin', 'superadmin')
  @Post(':id/documents')
  uploadDocument(@Param('id') id: string, @Req() req: Request, @CurrentUser() user: JwtPayload): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let resolved = false;
      let fileReceived = false;
      const fields: Record<string, string> = {};
      let savedDoc: unknown = null;
      let busboy: any;
      const done = (err?: Error, result?: unknown) => {
        if (resolved) return;
        resolved = true;
        if (err) reject(err);
        else resolve(result);
      };

      try {
        busboy = Busboy({ headers: req.headers, limits: { fileSize: MAX_SIZE, files: 1 } });
      } catch (err) {
        done(new BadRequestException({ message: 'Неверный формат запроса' }));
        return;
      }

      busboy.on('field', (name: string, value: string) => {
        fields[name] = value;
      });

      busboy.on('file', (_f: string, stream: any, info: any) => {
        fileReceived = true;
        const originalname = info.filename || 'document';
        const ext = path.extname(originalname).toLowerCase();
        if (!ALLOWED_DOC_EXTS.has(ext)) {
          stream.resume();
          done(new BadRequestException({ message: 'Неподдерживаемый формат документа' }));
          return;
        }
        let truncated = false;
        stream.on('limit', () => {
          truncated = true;
        });

        // Documents are sensitive (passports, contracts) — they go into the
        // PRIVATE uploads subtree, never the public capability-URL tier.
        this.storage
          .savePrivate(stream, ext, user.tenantID)
          .then(async (stored: { storedPath: string }) => {
            if (truncated) {
              done(new BadRequestException({ message: 'Файл слишком большой' }));
              return;
            }
            savedDoc = await this.employees.addDocument(user.tenantID, id, {
              type: fields.type || 'other',
              name: fields.name || originalname,
              storedPath: stored.storedPath,
              expiresAt: fields.expiresAt || null,
            });
            done(undefined, savedDoc);
          })
          .catch((err: unknown) => {
            this.logger.error(`Employee doc upload error: ${err}`);
            done(new InternalServerErrorException({ message: 'Ошибка сохранения' }));
          });
      });

      busboy.on('error', () => done(new InternalServerErrorException({ message: 'Ошибка загрузки' })));
      busboy.on('close', () => {
        if (!fileReceived && !resolved) done(new BadRequestException({ message: 'Файл не найден' }));
      });
      req.pipe(busboy);
    });
  }

  @Roles('director', 'admin', 'superadmin')
  @Delete(':id/documents/:docId')
  removeDocument(@Param('id') id: string, @Param('docId') docId: string, @CurrentUser() user: JwtPayload) {
    return this.employees.removeDocument(user.tenantID, id, docId);
  }

  // ── Achievements ───────────────────────────────────────────────────────

  @Get(':id/achievements')
  listAchievements(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.employees.listAchievements(user.tenantID, id);
  }

  @Roles('director', 'admin', 'superadmin')
  @Post(':id/achievements')
  addAchievement(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { name: string; description?: string; icon?: string; color?: string },
  ) {
    return this.employees.addAchievement(user.tenantID, user.userID, id, body);
  }

  @Roles('director', 'admin', 'superadmin')
  @Delete(':id/achievements/:achId')
  removeAchievement(@Param('id') id: string, @Param('achId') achId: string, @CurrentUser() user: JwtPayload) {
    return this.employees.removeAchievement(user.tenantID, id, achId);
  }
}
