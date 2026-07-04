import { Injectable, Logger, BadGatewayException, BadRequestException } from '@nestjs/common';

/**
 * Тонкий адаптер синхронного распознавания Яндекс SpeechKit
 * (REST v1, POST https://stt.api.cloud.yandex.net/speech/v1/stt:recognize).
 *
 * Аудио-байты НЕ трогаем (ffmpeg в контейнере нет и не будет) — тело запроса
 * уходит в Яндекс как есть, формат передаётся query-параметром `format`.
 * Формат — ДОГОВОРНОЙ КОНТРАКТ с mobile-волной (см. resolveFormat в
 * voice.service.ts): клиент присылает `format` явно, дефолт сервера пинится
 * env-переменной YC_STT_FORMAT. Официально v1 sync принимает oggopus | lpcm
 * (для lpcm обязателен sampleRateHertz); прочие значения прокидываются как
 * есть — если Яндекс расширит список, код менять не придётся.
 *
 * Auth — Api-Key сервисного аккаунта (роль ai.speechkit-stt.user):
 * `Authorization: Api-Key ${YC_API_KEY}` + folderId=${YC_FOLDER_ID}.
 * Ключи пусты → адаптер «не настроен», VoiceService отвечает 503
 * VOICE_NOT_CONFIGURED (dual-mode, как fiscal/telephony/wallet).
 *
 * YC_STT_URL — переопределение endpoint'а ТОЛЬКО для тестов (мок-сервер);
 * в проде переменная не задаётся.
 */
@Injectable()
export class YandexSttAdapter {
  private readonly logger = new Logger('YandexSttAdapter');

  private static readonly DEFAULT_URL = 'https://stt.api.cloud.yandex.net/speech/v1/stt:recognize';
  // Сетевой предохранитель: подвисший вызов Яндекса не должен держать worker.
  private static readonly TIMEOUT_MS = 15_000;

  get apiKey(): string {
    return (process.env.YC_API_KEY || '').trim();
  }

  get folderId(): string {
    return (process.env.YC_FOLDER_ID || '').trim();
  }

  /** Оба ключа заданы → голосовой ввод включён на сервере. */
  get isConfigured(): boolean {
    return this.apiKey !== '' && this.folderId !== '';
  }

  /**
   * Распознать короткое аудио. Возвращает сырой текст (может быть пустым —
   * тишина распознаётся в ''). Бросает BadRequest на 4xx Яндекса (клиент
   * прислал неподдерживаемое аудио) и BadGateway на 5xx/сеть/таймаут — в обоих
   * случаях VoiceService рефандит уже списанные блоки.
   */
  async recognize(input: {
    audio: Buffer;
    /** SpeechKit `format`: oggopus | lpcm | … (passthrough). */
    format: string;
    /** Обязателен для lpcm: 8000 | 16000 | 48000. */
    sampleRateHertz?: number;
  }): Promise<string> {
    const params = new URLSearchParams({
      topic: 'general',
      lang: 'ru-RU',
      folderId: this.folderId,
      format: input.format,
    });
    if (input.format === 'lpcm' && input.sampleRateHertz) {
      params.set('sampleRateHertz', String(input.sampleRateHertz));
    }
    const url = `${process.env.YC_STT_URL || YandexSttAdapter.DEFAULT_URL}?${params.toString()}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), YandexSttAdapter.TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Api-Key ${this.apiKey}`,
          'Content-Type': 'application/octet-stream',
        },
        body: new Uint8Array(input.audio),
        signal: controller.signal,
      });
    } catch {
      // Сеть / таймаут. Чистый 502 — никаких ключей в сообщении.
      throw new BadGatewayException({
        message: 'Сервис распознавания речи недоступен. Повторите позже.',
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!res.ok) {
      // Яндекс отвечает {error_code, error_message} (v1). Текст ошибки безопасен
      // (ключ в ответах не фигурирует) и полезен mobile-волне при подборе формата.
      const detail = String(json?.error_message || json?.message || '').slice(0, 200);
      this.logger.warn(`SpeechKit ${res.status}: ${detail || text.slice(0, 200)}`);
      if (res.status >= 400 && res.status < 500) {
        throw new BadRequestException({
          code: 'VOICE_STT_REJECTED',
          message: `Сервис распознавания отклонил аудио${detail ? `: ${detail}` : ''}`,
        });
      }
      throw new BadGatewayException({
        message: 'Сервис распознавания речи недоступен. Повторите позже.',
      });
    }

    return typeof json?.result === 'string' ? json.result.trim() : '';
  }
}
