import { Injectable, Logger } from '@nestjs/common';

/**
 * Полировка сырого STT-текста через YandexGPT Lite
 * (POST https://llm.api.cloud.yandex.net/foundationModels/v1/completion,
 * modelUri gpt://${YC_FOLDER_ID}/yandexgpt-lite, тот же Api-Key сервисного
 * аккаунта — роль ai.languageModels.user).
 *
 * СТРОГО best-effort: любой сбой (сеть, таймаут, квота, пустой ответ) →
 * null, и VoiceService отдаёт клиенту сырой STT-текст. Полировка никогда не
 * роняет транскрипцию и не влияет на списание минут (Яндекс биллит только STT,
 * GPT-вызов копеечный и в квоту не входит).
 *
 * Промпт жёсткий: запрещено ДОБАВЛЯТЬ факты — комментарий мастера попадает в
 * заказ-наряд, галлюцинация суммы/работы недопустима (ценность №3: надёжность
 * учёта). temperature 0.1, maxTokens 300 (комментарий ≤ 60 сек речи).
 *
 * YC_GPT_URL — переопределение endpoint'а ТОЛЬКО для тестов (мок-сервер).
 */
@Injectable()
export class YandexGptAdapter {
  private readonly logger = new Logger('YandexGptAdapter');

  private static readonly DEFAULT_URL = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';
  private static readonly TIMEOUT_MS = 12_000;

  private static readonly SYSTEM_PROMPT =
    'Ты редактор комментариев автосервиса. Перепиши текст кратко и по-деловому: ' +
    'убери слова-паразиты, повторы, междометия. СТРОГО ЗАПРЕЩЕНО добавлять факты, ' +
    'суммы, детали, которых нет в исходном тексте. Сохрани все упомянутые работы, ' +
    'детали, суммы, рекомендации. Ответь ТОЛЬКО итоговым текстом.';

  /**
   * Переписать текст по-деловому. null = полировка не удалась, взять сырой
   * текст. Никогда не бросает.
   */
  async polish(rawText: string): Promise<string | null> {
    const apiKey = (process.env.YC_API_KEY || '').trim();
    const folderId = (process.env.YC_FOLDER_ID || '').trim();
    if (!apiKey || !folderId || !rawText.trim()) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), YandexGptAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(process.env.YC_GPT_URL || YandexGptAdapter.DEFAULT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Api-Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          modelUri: `gpt://${folderId}/yandexgpt-lite`,
          completionOptions: { stream: false, temperature: 0.1, maxTokens: '300' },
          messages: [
            { role: 'system', text: YandexGptAdapter.SYSTEM_PROMPT },
            { role: 'user', text: rawText },
          ],
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn(`YandexGPT ${res.status} — отдаём сырой STT-текст`);
        return null;
      }
      const json: any = await res.json().catch(() => null);
      const polished = json?.result?.alternatives?.[0]?.message?.text;
      return typeof polished === 'string' && polished.trim() !== '' ? polished.trim() : null;
    } catch {
      this.logger.warn('YandexGPT недоступен/таймаут — отдаём сырой STT-текст');
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
