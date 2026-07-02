import {
  minBuildForPlatform,
  parseClientVersionResponse,
  shouldBlockClient,
  updateUrlForPlatform,
  type ClientVersionInfo,
} from '../clientVersionGate';

describe('shouldBlockClient', () => {
  it('блокирует сборку строго старше минимума', () => {
    expect(shouldBlockClient('35', 36)).toBe(true);
    expect(shouldBlockClient('1', 36)).toBe(true);
    expect(shouldBlockClient(35, 36)).toBe(true);
  });

  it('НЕ блокирует сборку равную минимуму или новее', () => {
    expect(shouldBlockClient('36', 36)).toBe(false);
    expect(shouldBlockClient('37', 36)).toBe(false);
    expect(shouldBlockClient('100', 36)).toBe(false);
    expect(shouldBlockClient(36, 36)).toBe(false);
  });

  it('минимум 0 = kill-switch выключен (серверный дефолт)', () => {
    expect(shouldBlockClient('1', 0)).toBe(false);
    expect(shouldBlockClient('35', 0)).toBe(false);
  });

  it('отрицательный / нечисловой / отсутствующий минимум = выключен', () => {
    expect(shouldBlockClient('1', -5)).toBe(false);
    expect(shouldBlockClient('1', NaN)).toBe(false);
    expect(shouldBlockClient('1', Infinity)).toBe(false);
    expect(shouldBlockClient('1', null)).toBe(false);
    expect(shouldBlockClient('1', undefined)).toBe(false);
  });

  it('fail-open при неизвестном текущем build (null/undefined/не-число)', () => {
    expect(shouldBlockClient(null, 36)).toBe(false);
    expect(shouldBlockClient(undefined, 36)).toBe(false);
    expect(shouldBlockClient('', 36)).toBe(false);
    expect(shouldBlockClient('abc', 36)).toBe(false);
  });

  it('переносит строки с пробелами и Android versionCode', () => {
    expect(shouldBlockClient(' 13 ', 14)).toBe(true);
    expect(shouldBlockClient(' 14 ', 14)).toBe(false);
  });
});

describe('parseClientVersionResponse', () => {
  it('парсит корректный ответ сервера', () => {
    const parsed = parseClientVersionResponse({
      minIosBuild: 36,
      minAndroidBuild: 14,
      iosUrl: 'https://testflight.apple.com/join/JfDQTjJ2',
      androidUrl: '',
      message: 'Обновите приложение',
    });
    expect(parsed).toEqual({
      minIosBuild: 36,
      minAndroidBuild: 14,
      iosUrl: 'https://testflight.apple.com/join/JfDQTjJ2',
      androidUrl: '',
      message: 'Обновите приложение',
    });
  });

  it('нормализует мусорные минимумы в 0 (= выключено), а не в блокировку', () => {
    const parsed = parseClientVersionResponse({
      minIosBuild: 'garbage',
      minAndroidBuild: -3,
      iosUrl: 42,
      androidUrl: null,
    });
    expect(parsed).toEqual({ minIosBuild: 0, minAndroidBuild: 0, iosUrl: '', androidUrl: '' });
  });

  it('строковые числа с сервера принимаются', () => {
    const parsed = parseClientVersionResponse({ minIosBuild: '36', minAndroidBuild: '14' });
    expect(parsed?.minIosBuild).toBe(36);
    expect(parsed?.minAndroidBuild).toBe(14);
  });

  it('пустой/пробельный message опускается', () => {
    expect(parseClientVersionResponse({ message: '  ' })?.message).toBeUndefined();
    expect(parseClientVersionResponse({})?.message).toBeUndefined();
  });

  it('не-объект → null (fail-open у вызывающего)', () => {
    expect(parseClientVersionResponse(null)).toBeNull();
    expect(parseClientVersionResponse(undefined)).toBeNull();
    expect(parseClientVersionResponse('ok')).toBeNull();
    expect(parseClientVersionResponse(200)).toBeNull();
  });
});

describe('platform helpers', () => {
  const info: ClientVersionInfo = {
    minIosBuild: 36,
    minAndroidBuild: 14,
    iosUrl: 'https://testflight.apple.com/join/JfDQTjJ2',
    androidUrl: 'https://example.com/app.apk',
    message: 'msg',
  };

  it('minBuildForPlatform выбирает платформенный минимум', () => {
    expect(minBuildForPlatform(info, 'ios')).toBe(36);
    expect(minBuildForPlatform(info, 'android')).toBe(14);
    // web / неизвестная платформа — гейт выключен
    expect(minBuildForPlatform(info, 'web')).toBe(0);
  });

  it('updateUrlForPlatform выбирает платформенный URL', () => {
    expect(updateUrlForPlatform(info, 'ios')).toBe('https://testflight.apple.com/join/JfDQTjJ2');
    expect(updateUrlForPlatform(info, 'android')).toBe('https://example.com/app.apk');
    expect(updateUrlForPlatform(info, 'web')).toBe('');
  });

  it('сквозной сценарий: build 35 на iOS при минимуме 36 блокируется, 36 — нет', () => {
    expect(shouldBlockClient('35', minBuildForPlatform(info, 'ios'))).toBe(true);
    expect(shouldBlockClient('36', minBuildForPlatform(info, 'ios'))).toBe(false);
  });
});
