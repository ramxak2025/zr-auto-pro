import { InvoiceOcrProvider } from './invoice-ocr.provider';
import { HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { OcrAnnotation } from './invoice-parser';

/** Official table OCR; documents are data and never executable instructions.
 * https://aistudio.yandex.ru/en/docs/vision/ocr/api-ref/TextRecognition/recognize
 */
@Injectable()
export class YandexInvoiceOcr extends InvoiceOcrProvider {
  readonly maxConcurrentDocuments = 2;
  assertConfigured() {
    if (process.env.INVOICE_OCR_ENABLED !== 'true' || !process.env.YC_API_KEY || !process.env.YC_FOLDER_ID) {
      throw new ServiceUnavailableException({
        code: 'OCR_NOT_CONFIGURED',
        message: 'Распознавание накладных временно недоступно',
      });
    }
  }

  async recognize(image: Buffer): Promise<OcrAnnotation> {
    this.assertConfigured();
    if (image.length > 10 * 1024 * 1024)
      throw new HttpException(
        { code: 'OCR_IMAGE_TOO_LARGE', message: 'Изображение слишком большое для распознавания' },
        413,
      );
    let response: globalThis.Response;
    try {
      response = await fetch('https://ai.api.cloud.yandex.net/ocr/v1/recognizeText', {
        method: 'POST',
        signal: AbortSignal.timeout(25000),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Api-Key ${process.env.YC_API_KEY}`,
          'x-folder-id': process.env.YC_FOLDER_ID!,
          'x-data-logging-enabled': 'false',
        },
        body: JSON.stringify({
          mimeType: 'JPEG',
          languageCodes: ['ru', 'en'],
          model: 'table',
          content: image.toString('base64'),
        }),
      });
    } catch {
      throw new HttpException(
        { code: 'OCR_PROVIDER_TIMEOUT', message: 'Сервис распознавания не ответил. Повторите попытку позже' },
        504,
      );
    }
    if (!response.ok) {
      // Never persist/log the provider body: it can contain document text or credentials.
      await response.body?.cancel();
      throw new HttpException(
        {
          code:
            response.status === 429
              ? 'OCR_PROVIDER_LIMIT'
              : response.status === 403 || response.status === 401
                ? 'OCR_ACCESS_DENIED'
                : 'OCR_PROVIDER_UNAVAILABLE',
          message:
            response.status === 429
              ? 'Сервис распознавания перегружен. Повторите позже'
              : response.status === 403 || response.status === 401
                ? 'Нет доступа к сервису распознавания. Проверьте права сервисного аккаунта'
                : 'Распознавание не выполнено. Можно повторить позже или заполнить поставку вручную',
        },
        response.status === 429 ? 429 : 502,
      );
    }
    const reader = response.body?.getReader();
    if (!reader)
      throw new HttpException(
        { code: 'OCR_INVALID_RESPONSE', message: 'Сервис распознавания вернул пустой ответ' },
        502,
      );
    let size = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > 4 * 1024 * 1024) {
        await reader.cancel();
        throw new HttpException({ code: 'OCR_INVALID_RESPONSE', message: 'Ответ распознавания слишком большой' }, 502);
      }
      chunks.push(result.value);
    }
    try {
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        result?: { textAnnotation?: OcrAnnotation };
      };
      if (
        !result.result?.textAnnotation ||
        (typeof result.result.textAnnotation.fullText !== 'string' &&
          !Array.isArray(result.result.textAnnotation.tables))
      )
        throw new Error();
      return result.result.textAnnotation;
    } catch {
      throw new HttpException(
        { code: 'OCR_INVALID_RESPONSE', message: 'Не удалось прочитать результат распознавания' },
        502,
      );
    }
  }
}
