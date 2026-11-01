import { isIP } from 'net';
import { HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { OcrAnnotation } from './invoice-parser';

export abstract class InvoiceOcrProvider {
  readonly maxConcurrentDocuments: number = 1;
  abstract assertConfigured(): void;
  abstract recognize(image: Buffer): Promise<OcrAnnotation>;
}

/** The operator configures this private origin. Documents never supply a URL. */
@Injectable()
export class LocalInvoiceOcr extends InvoiceOcrProvider {
  private endpoint(): URL {
    try {
      const url = new URL(process.env.INVOICE_OCR_WORKER_URL ?? '');
      const host = url.hostname.replace(/^\[|\]$/g, '');
      const address = isIP(host),
        octets = host.split('.').map(Number);
      const privateHost =
        host === 'localhost' ||
        host === '::1' ||
        (address === 4 &&
          (octets[0] === 127 ||
            octets[0] === 10 ||
            (octets[0] === 192 && octets[1] === 168) ||
            (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31))) ||
        /^[a-z][a-z0-9-]*$/i.test(host);
      if (
        !privateHost ||
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/ocr'
      )
        throw new Error();
      return url;
    } catch {
      throw new ServiceUnavailableException({
        code: 'OCR_NOT_CONFIGURED',
        message: 'Приватный сервис распознавания не настроен',
      });
    }
  }

  assertConfigured() {
    if (
      process.env.INVOICE_OCR_ENABLED !== 'true' ||
      !['local', undefined].includes(process.env.INVOICE_OCR_PROVIDER) ||
      !/^[\x21-\x7e]{32,256}$/.test(process.env.INVOICE_OCR_WORKER_TOKEN ?? '')
    ) {
      throw new ServiceUnavailableException({
        code: 'OCR_NOT_CONFIGURED',
        message: 'Приватный сервис распознавания временно недоступен',
      });
    }
    this.endpoint();
  }

  async recognize(image: Buffer): Promise<OcrAnnotation> {
    this.assertConfigured();
    if (!image.length || image.length > 10 * 1024 * 1024)
      throw new HttpException({ code: 'OCR_IMAGE_TOO_LARGE', message: 'Страница должна быть не больше 10 МБ' }, 413);
    try {
      const response = await fetch(this.endpoint(), {
        method: 'POST',
        signal: AbortSignal.timeout(30000),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.INVOICE_OCR_WORKER_TOKEN}`,
        },
        body: JSON.stringify({ imageBase64: image.toString('base64') }),
        redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel();
        const denied = [401, 403].includes(response.status),
          busy = response.status === 429,
          timeout = response.status === 504,
          invalid = [400, 413, 415, 422].includes(response.status);
        throw new HttpException(
          {
            code: busy
              ? 'OCR_BUSY'
              : timeout
                ? 'OCR_PROVIDER_TIMEOUT'
                : invalid
                  ? 'OCR_INVALID_IMAGE'
                  : denied
                    ? 'OCR_WORKER_ACCESS_DENIED'
                    : 'OCR_WORKER_UNAVAILABLE',
            message: busy
              ? 'Распознавание занято. Повторите позже'
              : timeout
                ? 'Страницу не удалось распознать за отведённое время'
                : invalid
                  ? 'Не удалось прочитать страницу. Переснимите её или заполните строки вручную'
                  : 'Приватный сервис распознавания недоступен',
          },
          busy ? 429 : timeout ? 504 : invalid ? 422 : 503,
        );
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty OCR response');
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 4 * 1024 * 1024) {
          await reader.cancel();
          throw new HttpException(
            { code: 'OCR_INVALID_RESPONSE', message: 'Ответ распознавания слишком большой' },
            502,
          );
        }
        chunks.push(part.value);
      }
      let annotation: OcrAnnotation;
      try {
        annotation = JSON.parse(Buffer.concat(chunks).toString('utf8')) as OcrAnnotation;
      } catch {
        throw new HttpException(
          { code: 'OCR_INVALID_RESPONSE', message: 'Не удалось прочитать результат распознавания' },
          502,
        );
      }
      if (
        !annotation ||
        typeof annotation !== 'object' ||
        typeof annotation.fullText !== 'string' ||
        !Array.isArray(annotation.tables) ||
        annotation.tables.length > 100 ||
        annotation.tables.some((table) => !table || typeof table !== 'object' || !Array.isArray(table.cells)) ||
        annotation.tables.reduce((sum, table) => sum + (Array.isArray(table.cells) ? table.cells.length : 20001), 0) >
          20000
      ) {
        throw new HttpException(
          { code: 'OCR_INVALID_RESPONSE', message: 'Сервис вернул неверный формат распознавания' },
          502,
        );
      }
      return annotation;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        { code: 'OCR_PROVIDER_TIMEOUT', message: 'Приватный сервис распознавания не ответил. Повторите позже' },
        504,
      );
    }
  }
}
