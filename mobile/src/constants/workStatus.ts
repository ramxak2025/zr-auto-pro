/**
 * Канбан work-status (доска заказ-нарядов, board 082).
 *
 * Единый источник правды для метаданных work-status — порядок колонок,
 * подписи, цвета и иконки. Используется и `WorkBoardScreen` (4 колонки),
 * и `CheckDetailScreen` (чип + пикер). Держим отдельно от экранов, чтобы
 * чип на детали чека и колонка на доске читались как ОДНО состояние
 * (одинаковый цвет / иконка / подпись).
 *
 * ВАЖНО: статус ОРТОГОНАЛЕН оплате/отложенности — это чистый board-флаг.
 * `workStatus === null` → заказ-наряд не на доске («не отслеживается»).
 * `checksApi.setWorkStatus` принимает ТОЛЬКО непустой union, поэтому снять
 * чек с доски через этот контракт нельзя — пикер не предлагает «снять».
 */
import { Ionicons } from '@expo/vector-icons';
import type { CheckWorkStatus } from '../../../shared/types';
import { colors } from '../theme';

/** Порядок прохождения по доске: приёмка → в работе → готов → выдан. */
export const WORK_STATUS_ORDER: CheckWorkStatus[] = ['accepted', 'in_progress', 'ready', 'delivered'];

export interface WorkStatusMeta {
  key: CheckWorkStatus;
  /** Подпись колонки / чипа. */
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Акцентный цвет (точка, иконка, текст активного чипа). */
  color: string;
  /** Мягкая подложка (фон чипа / колонки-хедера). */
  bg: string;
}

export const WORK_STATUS_META: Record<CheckWorkStatus, WorkStatusMeta> = {
  accepted: { key: 'accepted', label: 'Приёмка', icon: 'enter-outline', color: colors.blue[600], bg: colors.blue[50] },
  in_progress: {
    key: 'in_progress',
    label: 'В работе',
    icon: 'construct-outline',
    color: colors.amber[600],
    bg: colors.amber[50],
  },
  ready: {
    key: 'ready',
    label: 'Готов',
    icon: 'checkmark-done-outline',
    color: colors.green[600],
    bg: colors.green[50],
  },
  delivered: {
    key: 'delivered',
    label: 'Выдан',
    icon: 'flag-outline',
    color: colors.violet[600],
    bg: colors.violet[50],
  },
};

/** Первая колонка — куда падает заказ-наряд при «Поставить на доску». */
export const DEFAULT_WORK_STATUS: CheckWorkStatus = 'accepted';
