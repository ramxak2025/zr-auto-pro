import {
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
  BadRequestException,
  PayloadTooLargeException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import * as Busboy from 'busboy';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { VoiceService, VOICE_MAX_FILE_BYTES } from './voice.service';

/** Разобранный multipart-запрос транскрипции. */
interface ParsedTranscribeRequest {
  audio: Buffer | null;
  filename?: string;
  mimeType?: string;
  fields: Record<string, string>;
  truncated: boolean;
}

/**
 * Голосовой ввод комментария (миграция 115).
 *
 * POST /voice/transcribe — multipart/form-data (busboy-паттерн из uploads):
 *   • файл (любое имя поля, обычно `audio`) — байты записи, ≤ 2 МБ;
 *   • durationSeconds — заявленная длительность записи, сек (≤ 60);
 *   • format?          — SpeechKit-формат (oggopus | lpcm | …) — договорной
 *                        контракт с mobile-волной, прокидывается как есть;
 *   • sampleRateHertz? — для lpcm (8000 | 16000 | 48000).
 * Файл ЦЕЛИКОМ буферизуется в памяти (потолок 2 МБ × rate-limit 150 зап/мин —
 * приемлемо), на диск ничего не пишется, в Яндекс уходит и не сохраняется.
 *
 * GET /voice/usage — остаток пакета минут за текущий месяц (МСК). Доступен
 * любой роли тенанта (мастеру полезно видеть остаток при записи; только цифры).
 *
 * Ролевых гейтов нет намеренно: транскрипцию зовёт всякий, кто пишет
 * комментарии (мастера в первую очередь); тариф-гейт и квоту держит сервис.
 */
@UseGuards(JwtAuthGuard)
@Controller('voice')
export class VoiceController {
  private readonly logger = new Logger('VoiceController');

  constructor(private readonly voice: VoiceService) {}

  @Get('usage')
  usage(@CurrentUser() user: JwtPayload) {
    return this.voice.getUsage(user);
  }

  @Post('transcribe')
  async transcribe(@Req() req: Request, @CurrentUser() user: JwtPayload) {
    const parsed = await this.readMultipart(req);
    if (parsed.truncated) {
      throw new PayloadTooLargeException({ message: 'Аудио слишком большое (максимум 2 МБ)' });
    }
    if (!parsed.audio || parsed.audio.length === 0) {
      throw new BadRequestException({ message: 'Аудиофайл не найден в запросе' });
    }

    const durationSeconds = Number(parsed.fields.durationSeconds ?? parsed.fields.duration);
    const sampleRateHertz = Number(parsed.fields.sampleRateHertz);
    const format = (parsed.fields.format || '').trim();

    return this.voice.transcribe(user, {
      audio: parsed.audio,
      filename: parsed.filename,
      mimeType: parsed.mimeType,
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : undefined,
      format: format !== '' ? format : undefined,
      sampleRateHertz: Number.isFinite(sampleRateHertz) ? sampleRateHertz : undefined,
    });
  }

  /**
   * Busboy-разбор (паттерн uploads.controller): один файл + до 10 текстовых
   * полей. Поля формы могут прийти и ПОСЛЕ файла, поэтому пайплайн запускается
   * только на 'close', когда собрано всё.
   */
  private readMultipart(req: Request): Promise<ParsedTranscribeRequest> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err?: Error, result?: ParsedTranscribeRequest) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve(result as ParsedTranscribeRequest);
      };

      let busboy: any;
      try {
        busboy = Busboy({
          headers: req.headers,
          limits: { fileSize: VOICE_MAX_FILE_BYTES, files: 1, fields: 10, fieldSize: 1024 },
        });
      } catch (err) {
        this.logger.error(`Busboy init error: ${err}`);
        done(new BadRequestException({ message: 'Неверный формат запроса. Отправьте multipart/form-data' }));
        return;
      }

      const parsed: ParsedTranscribeRequest = { audio: null, fields: {}, truncated: false };
      const chunks: Buffer[] = [];

      busboy.on('file', (_fieldname: string, stream: any, info: any) => {
        parsed.filename = info?.filename || undefined;
        parsed.mimeType = info?.mimeType || undefined;
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('limit', () => {
          parsed.truncated = true;
        });
        stream.on('error', (err: Error) => {
          this.logger.error(`Audio stream error: ${err}`);
          done(new InternalServerErrorException({ message: 'Ошибка загрузки аудио' }));
        });
      });

      busboy.on('field', (name: string, value: string) => {
        parsed.fields[name] = value;
      });

      busboy.on('error', (err: Error) => {
        this.logger.error(`Busboy error: ${err}`);
        done(new InternalServerErrorException({ message: 'Ошибка загрузки аудио' }));
      });

      busboy.on('close', () => {
        parsed.audio = chunks.length > 0 ? Buffer.concat(chunks) : null;
        done(undefined, parsed);
      });

      req.pipe(busboy);
    });
  }
}
