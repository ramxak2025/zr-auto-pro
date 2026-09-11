import { Building2, Home } from 'lucide-react';
import { usePointAccess, pointKindLabel } from '../hooks/usePoints';

/**
 * PointIndicator — НЕинтерактивный индикатор автосервиса ТЕКУЩЕЙ СЕССИИ в
 * шапке (мульти-точки 156/160/161/163).
 *
 * ЧТО ЭТО И ПОЧЕМУ НЕ ПЕРЕКЛЮЧАТЕЛЬ. У владельца два РАЗНЫХ автосервиса:
 * основной («ZR AUTO» — сам сервис, вся история до появления филиалов) и
 * открытый позже филиал («ТопГаз»). Филиал выбирается ОДИН РАЗ, при входе
 * (163), и живёт ровно столько, сколько живёт сессия. Сменить его внутри
 * приложения нельзя вообще — ни отсюда, ни из раздела «Филиалы»: там для этого
 * предлагают выйти и войти заново.
 *
 * Поэтому здесь остался ровно один смысл: ПОКАЗАТЬ, где человек сейчас
 * работает, до того как он нажмёт «Пробить». Ни выпадающего списка, ни
 * перехода: первая волна ставила сюда выбор, и одним промахом мыши касса
 * уезжала в соседний автосервис — заметить это можно было уже только по чужой
 * выручке. Вторая заменила выбор ссылкой на раздел, но клик по шапке уносил
 * страницу из-под набранного заказ-наряда. Теперь это просто подпись.
 *
 * КОГДА НЕ РИСУЕТСЯ: у тенанта один автосервис (`multiPoint` в hooks/usePoints)
 * — подпись «ZR AUTO» была бы шумом; либо филиал сессии ещё неизвестен
 * (холодный старт до ответа сети) — пустая или гадательная подпись в денежной
 * шапке хуже её отсутствия.
 */
export default function PointIndicator() {
  const { currentPoint, multiPoint } = usePointAccess();

  if (!multiPoint || !currentPoint) return null;

  const kind = pointKindLabel(currentPoint);
  // Дом = сам автосервис владельца, здание = открытый позже филиал.
  const Icon = currentPoint.isMain ? Home : Building2;

  return (
    <span
      className="flex max-w-[240px] items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm font-medium text-gray-700"
      title={`Вы работаете здесь: ${currentPoint.name} — ${kind.toLowerCase()}`}
    >
      <Icon className="h-4 w-4 flex-shrink-0 text-gray-400" />
      <span className="truncate">{currentPoint.name}</span>
    </span>
  );
}
