import { Module } from '@nestjs/common';
import { AdminSettingsController } from './admin-settings.controller';
import { PlatformSettingsService } from './platform-settings.service';

/**
 * Глобальные (без-тенантные) настройки платформы, редактируемые супер-админом
 * (миграция 116, синглтон platform_settings). Сейчас единственный ключ —
 * global_free_voice_minutes, который читает VoiceModule (импортирует этот
 * модуль ради PlatformSettingsService). Экспортируем сервис, чтобы другие
 * модули могли читать/писать настройки, не дублируя SQL.
 */
@Module({
  controllers: [AdminSettingsController],
  providers: [PlatformSettingsService],
  exports: [PlatformSettingsService],
})
export class SettingsModule {}
