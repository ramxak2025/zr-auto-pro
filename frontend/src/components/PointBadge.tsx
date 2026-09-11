import { Building2, Home } from 'lucide-react';

import { usePointAccess, pointKindLabel } from '../hooks/usePoints';

/**
 * PointBadge — подпись «этой СТРОКЕ принадлежит такой-то автосервис».
 *
 * ЧЕМ ОТЛИЧАЕТСЯ ОТ PointIndicator. Тот показывает филиал СЕССИИ (где сейчас
 * работает человек) и живёт в шапке. Этот — филиал КОНКРЕТНОЙ ЗАПИСИ
 * (`pointId` строки: кассовая смена, чек, расход) и живёт рядом с самой
 * записью. Путать их нельзя: совпадение подписи в шапке и принадлежности
 * строки — это как раз то, что владелец обязан видеть, а не додумывать.
 *
 * ЗАЧЕМ ЭТО ВООБЩЕ НУЖНО. Филиал — отдельный автосервис со своими деньгами
 * (160/161). Строка без подписи в мульти-точечном тенанте неотличима от своей:
 * на кассовой смене это приводило к тому, что владелец закрывал смену СОСЕДНЕГО
 * автосервиса, а её фактический нал и недостача уезжали в чужой Z-отчёт.
 *
 * КОГДА НЕ РИСУЕТСЯ:
 *   • у тенанта один автосервис (`multiPoint`) — подпись была бы шумом;
 *   • `pointId` пуст (историческая строка одноточечного периода) или точка не
 *     найдена в списке живых (архивный филиал) — гадать нельзя, молчим.
 */
export default function PointBadge({ pointId, className }: { pointId?: string | null; className?: string }) {
  const { points, multiPoint } = usePointAccess();

  if (!multiPoint || !pointId) return null;
  const point = points.find((p) => p.id === pointId);
  if (!point) return null;

  // Дом = сам автосервис владельца, здание = открытый позже филиал (160).
  const Icon = point.isMain ? Home : Building2;

  return (
    <span
      className={`inline-flex max-w-[200px] items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 ${className ?? ''}`}
      title={`${pointKindLabel(point)}: ${point.name}`}
    >
      <Icon className="h-3 w-3 flex-shrink-0 text-gray-400" />
      <span className="truncate">{point.name}</span>
    </span>
  );
}
