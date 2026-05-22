import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Req,
  UseGuards,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { CheckPhotosService } from './check-photos.service';
import * as Busboy from 'busboy';
import * as path from 'path';

const MAX_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

@UseGuards(JwtAuthGuard)
@Controller('check-photos')
export class CheckPhotosController {
  private readonly logger = new Logger('CheckPhotosController');

  constructor(private readonly checkPhotosService: CheckPhotosService) {}

  @Get(':checkId')
  getByCheck(@Param('checkId') checkId: string, @CurrentUser() user: JwtPayload) {
    return this.checkPhotosService.getByCheck(checkId, user.tenantID);
  }

  @Post(':checkId')
  async upload(@Param('checkId') checkId: string, @Req() req: Request, @CurrentUser() user: JwtPayload): Promise<any> {
    return new Promise((resolve, reject) => {
      let resolved = false;
      let fileReceived = false;

      const done = (err?: Error, result?: any) => {
        if (resolved) return;
        resolved = true;
        if (err) reject(err);
        else resolve(result);
      };

      let busboy: any;
      try {
        busboy = Busboy({
          headers: req.headers,
          limits: { fileSize: MAX_SIZE, files: 1 },
        });
      } catch (err) {
        this.logger.error(`Busboy init error: ${err}`);
        done(new BadRequestException({ message: 'Неверный формат запроса. Отправьте multipart/form-data' }));
        return;
      }

      busboy.on('file', (fieldname: string, stream: any, info: any) => {
        fileReceived = true;
        const originalname = info.filename || 'file';
        const ext = path.extname(originalname).toLowerCase();

        if (!ALLOWED_EXTS.has(ext)) {
          stream.resume();
          done(new BadRequestException({ message: 'Неподдерживаемый формат. Используйте JPG, PNG, WebP' }));
          return;
        }

        let truncated = false;
        stream.on('limit', () => {
          truncated = true;
        });

        this.checkPhotosService
          .create(checkId, user.tenantID, user.userID, stream, ext)
          .then((result) => {
            if (truncated) {
              done(new BadRequestException({ message: 'Файл слишком большой (макс 10МБ)' }));
              return;
            }
            done(undefined, result);
          })
          .catch((err) => {
            this.logger.error(`Check photo upload error: ${err}`);
            done(new InternalServerErrorException({ message: 'Ошибка сохранения фото' }));
          });
      });

      busboy.on('error', (err: Error) => {
        this.logger.error(`Busboy error: ${err}`);
        done(new InternalServerErrorException({ message: 'Ошибка загрузки файла' }));
      });

      busboy.on('close', () => {
        if (!fileReceived && !resolved) {
          done(new BadRequestException({ message: 'Файл не найден в запросе' }));
        }
      });

      req.pipe(busboy);
    });
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.checkPhotosService.remove(id, user.tenantID);
  }
}
