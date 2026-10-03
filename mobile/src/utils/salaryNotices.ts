import type { SalaryFine, SalaryPayment, SalaryPayout } from '../../../shared/types';
import type { SalaryAckKind } from './salaryAckQueue';

export type SalaryNotice =
  | { kind: 'fineViewed'; item: SalaryFine }
  | { kind: 'payoutViewed'; item: SalaryPayout }
  | { kind: 'paymentConfirmed'; item: SalaryPayment };

/** Preserve kopecks: a notice must show the same amount as the ledger. */
export function formatSalaryNoticeAmount(amount: number): string {
  return `${amount.toLocaleString('ru-RU', {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

/** Push is only a wake-up signal; all money/reasons come from the scoped API. */
export function isSalaryNoticePush(data: Record<string, unknown> | undefined): boolean {
  return [data?.type, data?.kind].some(
    (value) => typeof value === 'string' && /salary|payout|payment|penalty/.test(value),
  );
}

export async function loadSalaryNotice(deps: {
  userId: string;
  fines: () => Promise<SalaryFine[]>;
  payouts: () => Promise<SalaryPayout[]>;
  payments: () => Promise<SalaryPayment[]>;
  suppressed: (kind: SalaryAckKind, id: string) => boolean;
  isCurrent: () => boolean;
}): Promise<{ stale: boolean; notice: SalaryNotice | null; failed: SalaryAckKind[] }> {
  const failed: SalaryAckKind[] = [];
  const sources: Array<{
    kind: SalaryAckKind;
    fetch: () => Promise<Array<SalaryFine | SalaryPayout | SalaryPayment>>;
  }> = [
    { kind: 'fineViewed', fetch: deps.fines },
    { kind: 'payoutViewed', fetch: deps.payouts },
    { kind: 'paymentConfirmed', fetch: deps.payments },
  ];
  for (const source of sources) {
    if (!deps.isCurrent()) return { stale: true, notice: null, failed };
    try {
      const rows = await source.fetch();
      if (!deps.isCurrent()) return { stale: true, notice: null, failed };
      const item = rows.find((row) => {
        if (row.userId !== deps.userId || deps.suppressed(source.kind, row.id)) return false;
        if (source.kind === 'fineViewed') return !(row as SalaryFine).viewedAt;
        if (source.kind === 'payoutViewed') {
          const payout = row as SalaryPayout;
          return payout.status === 'accepted' && !payout.viewedAt;
        }
        const payment = row as SalaryPayment;
        return !payment.confirmedAt && !payment.reversedAt;
      });
      if (item) return { stale: false, notice: { kind: source.kind, item } as SalaryNotice, failed };
    } catch {
      failed.push(source.kind);
    }
  }
  return { stale: !deps.isCurrent(), notice: null, failed };
}
