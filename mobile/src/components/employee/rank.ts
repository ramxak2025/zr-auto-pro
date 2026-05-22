/**
 * rank.ts — derive an employee's "rank" (Bronze/Silver/Gold/Platinum)
 * + level number purely from their lifetime stats + efficiency score.
 * Centralised so the hero header AND the share-card preview agree.
 *
 * Thresholds match the spec:
 *   Bronze   — revenue < 100k   (level = ceil(checks / 10), min 1)
 *   Silver   — 100k–500k        (level = ceil(checks / 10), min 1)
 *   Gold     — 500k–1.5M        (level = ceil(checks / 10), min 1)
 *   Platinum — 1.5M+
 *
 * Level is a "soft" gamification number — never used for permissions or
 * payouts. The intent is to give the card a tangible "you grew from 12
 * to 14" feeling between visits.
 */
import { colors } from '../../theme';

export type Rank = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface RankInfo {
  rank: Rank;
  level: number;
  /** Lower bound revenue for the current rank. */
  fromRevenue: number;
  /** Upper bound (Infinity for platinum). */
  toRevenue: number;
  /** Russian label of the rank — "Бронза" / "Серебро" / "Золото" / "Платина". */
  ruLabel: string;
  /** Solid bright colour. */
  accent: string;
  /** Subtle/translucent accent for chip backgrounds. */
  accentSoft: string;
  /** Hero gradient (3 stops, top-left → bottom-right). */
  gradient: [string, string, string];
}

const RANKS: Record<Rank, Omit<RankInfo, 'level' | 'rank'>> = {
  bronze: {
    fromRevenue: 0,
    toRevenue: 100_000,
    ruLabel: 'Бронза',
    accent: '#B45309', // amber-700 — coppery brown
    accentSoft: 'rgba(180, 83, 9, 0.22)',
    gradient: ['#B45309', '#92400E', '#451A03'],
  },
  silver: {
    fromRevenue: 100_000,
    toRevenue: 500_000,
    ruLabel: 'Серебро',
    accent: '#475569', // slate-600
    accentSoft: 'rgba(71, 85, 105, 0.22)',
    gradient: ['#94A3B8', '#475569', '#1E293B'],
  },
  gold: {
    fromRevenue: 500_000,
    toRevenue: 1_500_000,
    ruLabel: 'Золото',
    accent: '#D97706', // amber-600
    accentSoft: 'rgba(217, 119, 6, 0.22)',
    gradient: ['#FBBF24', '#D97706', '#7C2D12'],
  },
  platinum: {
    fromRevenue: 1_500_000,
    toRevenue: Infinity,
    ruLabel: 'Платина',
    accent: '#0F766E', // teal-700, premium mint
    accentSoft: 'rgba(15, 118, 110, 0.22)',
    gradient: ['#5EEAD4', '#0F766E', '#134E4A'],
  },
};

export function rankFromLifetime(totalRevenue: number, totalChecks: number): RankInfo {
  let key: Rank = 'bronze';
  if (totalRevenue >= 1_500_000) key = 'platinum';
  else if (totalRevenue >= 500_000) key = 'gold';
  else if (totalRevenue >= 100_000) key = 'silver';
  // Level: 1 + floor(checks/10). Minimum 1. Caps at 99 so the badge stays compact.
  const level = Math.max(1, Math.min(99, Math.floor(totalChecks / 10) + 1));
  return { rank: key, level, ...RANKS[key] };
}

/**
 * Progress toward the next rank, 0..1.  Returns 1 for platinum (already maxed).
 */
export function progressToNextRank(info: RankInfo, totalRevenue: number): number {
  if (info.rank === 'platinum') return 1;
  const span = info.toRevenue - info.fromRevenue;
  if (span <= 0) return 1;
  return Math.max(0, Math.min(1, (totalRevenue - info.fromRevenue) / span));
}

export function rankLabelUpper(info: RankInfo): string {
  // Two-line short-form used in pill badges: "GOLD · LVL 24".
  const en =
    info.rank === 'bronze'
      ? 'BRONZE'
      : info.rank === 'silver'
        ? 'SILVER'
        : info.rank === 'gold'
          ? 'GOLD'
          : 'PLATINUM';
  return `${en} · LVL ${info.level}`;
}

// Service-mastery tier colours — used both for the row tier badges and
// (later, if needed) the trophy case.
export const SERVICE_TIER_COLOR: Record<'bronze' | 'silver' | 'gold' | 'platinum', { bg: string; fg: string }> = {
  bronze: { bg: 'rgba(180, 83, 9, 0.12)', fg: '#B45309' },
  silver: { bg: 'rgba(71, 85, 105, 0.12)', fg: '#475569' },
  gold: { bg: 'rgba(217, 119, 6, 0.12)', fg: colors.amber[700] },
  platinum: { bg: 'rgba(15, 118, 110, 0.14)', fg: '#0F766E' },
};
