import { Module } from '@nestjs/common';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { YandexSttAdapter } from './yandex-stt.adapter';
import { YandexGptAdapter } from './yandex-gpt.adapter';

/**
 * Голосовой ввод комментария (SpeechKit STT + YandexGPT-полировка) с
 * помесячными пакетами минут по тарифам — миграция 115.
 * Без ключей Яндекса (YC_API_KEY / YC_FOLDER_ID) модуль отвечает
 * 503 VOICE_NOT_CONFIGURED — dual-mode, как fiscal / telephony / wallet.
 */
@Module({
  controllers: [VoiceController],
  providers: [VoiceService, YandexSttAdapter, YandexGptAdapter],
})
export class VoiceModule {}
