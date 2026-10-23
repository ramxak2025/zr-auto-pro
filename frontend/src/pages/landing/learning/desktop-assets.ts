import type { LearningAsset } from './assets';

export type DesktopCaptureId = `desktop-${string}`;
export interface DesktopLearningAsset extends Omit<LearningAsset, 'provenance'> {
  provenance: {
    sourceCommit: string;
    browser: 'Chrome';
    platform: 'desktop';
    framing: 'content-viewport';
    data: 'training-account';
    capturedAt: string;
    screen: string;
    sha256: string;
    viewport: { width: number; height: number };
  };
}

// Reviewed fresh Chrome product viewports; original pixels and variable dimensions are preserved.
export const desktopLearningAssets: Partial<Record<DesktopCaptureId, DesktopLearningAsset>> = {
  'desktop-dashboard-overview': {
    src: '/learning/desktop-dashboard-overview-ebb98550.webp',
    width: 2592,
    height: 1544,
    alt: 'Главная Autexa: рабочее меню, поиск клиентов и карточки дневной выручки и кассы.',
    provenance: {
      sourceCommit: '873cba37f7d6236d9f241630945acc3c800fd6f5',
      browser: 'Chrome',
      platform: 'desktop',
      framing: 'content-viewport',
      data: 'training-account',
      capturedAt: '2026-10-23T11:14:58.405352Z',
      screen: 'Главная: рабочее меню, ссылка «Найти клиента», карточки выручки и кассы за сегодня.',
      sha256: 'ebb98550640e00a860b786196adf7f5831cc6275c39af7415f60fefc21b2cce3',
      viewport: {
        width: 2592,
        height: 1544,
      },
    },
  },
  'desktop-clients-overview': {
    src: '/learning/desktop-clients-overview-235116ef.webp',
    width: 2632,
    height: 1584,
    alt: 'Раздел Autexa «Клиенты»: поиск и таблица клиентов учебного сервиса.',
    provenance: {
      sourceCommit: '873cba37f7d6236d9f241630945acc3c800fd6f5',
      browser: 'Chrome',
      platform: 'desktop',
      framing: 'content-viewport',
      data: 'training-account',
      capturedAt: '2026-10-23T11:17:24Z',
      screen: 'Список клиентов с поиском, импортом, экспортом и действиями по строке.',
      sha256: '235116ef58075a1593c9bb9e4847a8a97e80798a807c873bdd50f4c67e700c3f',
      viewport: {
        width: 2632,
        height: 1584,
      },
    },
  },
};
