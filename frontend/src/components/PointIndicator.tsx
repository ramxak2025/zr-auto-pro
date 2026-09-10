import { Link } from 'react-router-dom';
import { Building2, Home, AlertTriangle, ChevronRight } from 'lucide-react';
import { usePointAccess, ALL_POINTS_LABEL, NO_POINT_LABEL, pointKindLabel } from '../hooks/usePoints';

/**
 * PointIndicator — НЕинтерактивный индикатор текущего автосервиса в шапке
 * (мульти-точки 156/160/161).
 *
 * ЧТО ПОКАЗЫВАЕТ И ПОЧЕМУ НЕ ПЕРЕКЛЮЧАЕТ. Текущий автосервис хранится на
 * сервере, поэтому веб всегда работает «внутри» одного из них — человек обязан
 * это видеть, иначе примет выручку одного за выручку обоих. Но переключаться
 * отсюда нельзя: у владельца это два РАЗНЫХ автосервиса (основной «ZR AUTO» и
 * открытый позже филиал), и его требование дословно — «переключиться туда
 * можно ТОЛЬКО через филиал, а не везде». Раньше здесь висел выпадающий
 * список, из которого одним промахом мыши касса уезжала в соседний автосервис.
 *
 * Теперь это ссылка на страницу «Филиалы» (/points) — единственное место
 * перехода, где рядом с каждым автосервисом видны его цифры.
 *
 * КОГДА НЕ РИСУЕТСЯ: показывать нечего (см. `multiPoint` в hooks/usePoints).
 */
export default function PointIndicator() {
  const { currentPointId, currentPoint, canSeeAllPoints, multiPoint } = usePointAccess();

  if (!multiPoint) return null;

  // Автосервис не выбран — не нейтральное состояние: денежную запись сервер в
  // этом режиме не примет (400 «Выберите филиал»). Янтарный, чтобы читалось
  // как «нужно зайти в свой автосервис», а не как обычная подпись.
  const noPointChosen = currentPointId === null;
  const label = currentPoint?.name ?? (canSeeAllPoints ? ALL_POINTS_LABEL : NO_POINT_LABEL);
  const kind = currentPoint ? pointKindLabel(currentPoint) : 'Общая сводка по всем';
  // Дом = сам автосервис владельца, здание = открытый позже филиал.
  const Icon = noPointChosen ? AlertTriangle : currentPoint?.isMain ? Home : Building2;

  return (
    <Link
      to="/points"
      className={`flex max-w-[240px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-colors ${
        noPointChosen
          ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
      }`}
      title={`${label} — ${kind}. Открыть «Филиалы»`}
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span className="truncate">{label}</span>
      {/* ChevronRight, а НЕ ChevronDown: стрелка вниз обещала бы выпадающий
          список, которого здесь больше нет — только переход в раздел. */}
      <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
    </Link>
  );
}
