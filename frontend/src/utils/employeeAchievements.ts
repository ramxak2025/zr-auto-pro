/**
 * Per-user "achievement" badges shown on the Employees page.
 *
 * The owner asked for fun, half-serious labels — "Рекордсмен по чекам",
 * "Премиум-мастер", "Самые низкие цены" (миротворец), "Лучший в отдыхе",
 * etc. They're computed across the whole roster for the same period the
 * page currently displays, so the badges shift when the owner switches
 * Сегодня → Месяц.
 *
 * Each rule picks at most one winner. Ties go to the first match — fine
 * for a UX gimmick, not a podium.
 */

export interface AchievementInput {
  userId: string;
  role: string;
  /** From MasterSalary aggregate. Undefined if the user wasn't a master in
   *  the period. */
  earnings?: number;
  revenue?: number;
  /** Number of cut checks. */
  checkCount?: number;
  /** Attendance counters. */
  scheduled?: number;
  worked?: number;
  daysOff?: number;
  lateMajor?: number;
}

export interface Achievement {
  /** Stable id so React lists keep keys stable. */
  id: string;
  emoji: string;
  label: string;
  /** Explanation shown on hover / under the chip. */
  hint: string;
}

/**
 * @param all — every user that should be considered for "winners".
 *              Pass only active staff, otherwise inactive users skew
 *              the rankings.
 * @returns map userId → list of achievements (0–N).
 */
export function computeAchievements(all: AchievementInput[]): Map<string, Achievement[]> {
  const out = new Map<string, Achievement[]>();
  const push = (uid: string, a: Achievement) => {
    const bucket = out.get(uid) ?? [];
    bucket.push(a);
    out.set(uid, bucket);
  };

  // Restrict revenue/check rankings to masters who actually had any activity.
  const masters = all.filter((u) => u.role === 'master');
  const withChecks = masters.filter((u) => (u.checkCount ?? 0) > 0);
  const withRevenue = masters.filter((u) => (u.revenue ?? 0) > 0);

  // 1. 🏆 Most checks cut — clear-cut performance metric.
  if (withChecks.length >= 2) {
    const top = withChecks.reduce((a, b) =>
      (b.checkCount ?? 0) > (a.checkCount ?? 0) ? b : a,
    );
    push(top.userId, {
      id: 'top-checks',
      emoji: '🏆',
      label: 'Рекордсмен',
      hint: `Больше всех чеков — ${top.checkCount}`,
    });
  }

  // 2. 💎 Premium master — highest avg ticket size.
  if (withChecks.length >= 2) {
    const withAvg = withChecks
      .map((u) => ({ ...u, avg: (u.revenue ?? 0) / Math.max(u.checkCount ?? 1, 1) }))
      .filter((u) => u.avg > 0);
    if (withAvg.length >= 2) {
      const top = withAvg.reduce((a, b) => (b.avg > a.avg ? b : a));
      push(top.userId, {
        id: 'premium-master',
        emoji: '💎',
        label: 'Премиум-мастер',
        hint: `Самый дорогой средний чек — ${Math.round(top.avg).toLocaleString('ru-RU')} ₽`,
      });
    }
  }

  // 3. 🕊️ "Миротворец" — lowest avg ticket. Funny, not insulting.
  if (withChecks.length >= 3) {
    const withAvg = withChecks
      .map((u) => ({ ...u, avg: (u.revenue ?? 0) / Math.max(u.checkCount ?? 1, 1) }))
      .filter((u) => u.avg > 0);
    if (withAvg.length >= 3) {
      const bottom = withAvg.reduce((a, b) => (b.avg < a.avg ? b : a));
      push(bottom.userId, {
        id: 'peacekeeper',
        emoji: '🕊️',
        label: 'Миротворец',
        hint: 'Самые щадящие цены среди мастеров',
      });
    }
  }

  // 4. 💰 Money-maker — highest absolute earnings. Different from "most checks"
  // because high-volume vs high-ticket are different stories.
  if (withRevenue.length >= 2) {
    const top = withRevenue.reduce((a, b) =>
      (b.revenue ?? 0) > (a.revenue ?? 0) ? b : a,
    );
    // Skip if same person already got "Рекордсмен" — too redundant.
    const existing = out.get(top.userId) ?? [];
    if (!existing.some((a) => a.id === 'top-checks')) {
      push(top.userId, {
        id: 'money-maker',
        emoji: '💰',
        label: 'Кассир',
        hint: `Принёс больше всех — ${Math.round(top.revenue ?? 0).toLocaleString('ru-RU')} ₽`,
      });
    }
  }

  // 5. ✨ Best attendance — most worked shifts (out of scheduled).
  const withSchedule = all.filter((u) => (u.scheduled ?? 0) > 0);
  if (withSchedule.length >= 2) {
    const ratio = (u: AchievementInput) =>
      (u.worked ?? 0) / Math.max(u.scheduled ?? 1, 1);
    const top = withSchedule.reduce((a, b) => (ratio(b) > ratio(a) ? b : a));
    if (ratio(top) >= 0.9) {
      push(top.userId, {
        id: 'iron-attendance',
        emoji: '✨',
        label: 'Железная дисциплина',
        hint: `${top.worked} из ${top.scheduled} смен на месте`,
      });
    }
  }

  // 6. 🛌 "Лучший в отдыхе" — most days off in the period. Tongue-in-cheek.
  if (withSchedule.length >= 2) {
    const top = withSchedule.reduce((a, b) =>
      (b.daysOff ?? 0) > (a.daysOff ?? 0) ? b : a,
    );
    if ((top.daysOff ?? 0) >= 2) {
      push(top.userId, {
        id: 'best-rester',
        emoji: '🛌',
        label: 'Чемпион выходного',
        hint: `${top.daysOff} выходных`,
      });
    }
  }

  // 7. 🐢 Most late-majors. Leave it on so it's gentle peer pressure.
  if (withSchedule.length >= 2) {
    const top = withSchedule.reduce((a, b) =>
      (b.lateMajor ?? 0) > (a.lateMajor ?? 0) ? b : a,
    );
    if ((top.lateMajor ?? 0) >= 2) {
      push(top.userId, {
        id: 'turtle',
        emoji: '🐢',
        label: 'Соня',
        hint: `Опоздал >1 ч ${top.lateMajor} ${pluralRu(top.lateMajor!, 'раз', 'раза', 'раз')}`,
      });
    }
  }

  return out;
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
