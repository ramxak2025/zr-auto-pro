import { Building2, Home } from 'lucide-react';

import { usePointAccess, pointKindLabel } from '../hooks/usePoints';
import { Badge } from '../ui/Badge';

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
    <Badge outline size="sm" icon={Icon} title={`${pointKindLabel(point)}: ${point.name}`} className={className}>
      {point.name}
    </Badge>
  );
}
