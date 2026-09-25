import { ArrowLeft, Building2, ChevronRight, Home, Loader2 } from 'lucide-react';
import type { LoginPointOption } from '../../../shared/api/types';
import { Badge } from '../ui/Badge';
import { IconButton } from '../ui/IconButton';
import { cn } from '../ui/cn';
import { focusRing, toneChip } from '../ui/tokens';

/**
 * LoginPointSelect — ВТОРОЙ ШАГ ВХОДА: «в какой филиал зайти» (163).
 *
 * ТРЕБОВАНИЕ ВЛАДЕЛЬЦА ДОСЛОВНО: «чтобы они заходили, например, введя номер и
 * пароль свой, и им показывал выбор, в какой филиал из доступных для них они
 * могли зайти. И чтобы выйти и войти в другой им надо опять выйти и войти».
 *
 * ПОЧЕМУ ЭТО ПОЛНОЦЕННЫЙ ШАГ, А НЕ ВЫПАДАЮЩИЙ СПИСОК В ФОРМЕ. Филиал — это не
 * настройка, а ответ на вопрос «где я сегодня работаю»: от него зависит, в чью
 * выручку уйдёт заказ-наряд и из чьей кассы выдадут зарплату. Селект
 * пролистывают не глядя; крупные карточки с адресом заставляют прочитать, куда
 * человек заходит. Сессии в этот момент ещё НЕТ — на руках только промежуточный
 * токен на пять минут.
 *
 * Компонент чистый: ни запросов, ни состояния. Обмен токена на сессию и разбор
 * отказов живут в LoginPage — там же, где хранится промежуточный токен.
 */
export interface LoginPointSelectProps {
  /** Доступные сотруднику живые филиалы; порядок сервера (основной сервис первым). */
  points: LoginPointOption[];
  /** Где человек работал в прошлый раз — подсвечиваем, но НЕ выбираем за него. */
  defaultPointId: string;
  /** Идёт обмен по этому филиалу; null — ничего не отправляем. */
  submittingPointId: string | null;
  onSelect: (pointId: string) => void;
  /** «Назад» — вернуться к телефону и паролю (промежуточный токен просто бросаем). */
  onBack: () => void;
}

export default function LoginPointSelect({
  points,
  defaultPointId,
  submittingPointId,
  onSelect,
  onBack,
}: LoginPointSelectProps) {
  const busy = submittingPointId !== null;

  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 flex items-center gap-3">
        <IconButton
          label="Назад, к вводу телефона и пароля"
          icon={ArrowLeft}
          variant="secondary"
          onClick={onBack}
          disabled={busy}
          className="rounded-full"
        />
        <div className="min-w-0">
          <h1 className="text-md font-semibold text-ink">Выберите филиал</h1>
          <p className="text-xs text-ink-3">Куда вы заходите работать</p>
        </div>
      </div>

      {/* Честное объяснение ПРАВИЛА, а не украшение: человек должен узнать про
          «выйти и войти» здесь, а не когда будет искать переключатель. */}
      <p className="mb-5 text-sm leading-relaxed text-ink-2">
        Вы войдёте в один филиал — вся касса, склад и зарплата смены будут его. Чтобы работать в другом, нужно выйти и
        войти заново.
      </p>

      <ul className="space-y-3" aria-label="Доступные филиалы">
        {points.map((point) => (
          <li key={point.id}>
            <PointRow
              point={point}
              isLast={point.id === defaultPointId}
              busy={submittingPointId === point.id}
              // Второй клик по второй карточке, пока летит первый обмен, сжёг бы
              // одноразовый токен: сервер ответил бы «Выбор филиала уже
              // использован», и человек начинал бы вход заново на ровном месте.
              disabled={busy && submittingPointId !== point.id}
              onSelect={() => onSelect(point.id)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Карточка филиала. Крупная и с адресом: у владельца два автосервиса могут
 * называться похоже, и адрес — единственное, что различает их наверняка.
 */
function PointRow({
  point,
  isLast,
  busy,
  disabled,
  onSelect,
}: {
  point: LoginPointOption;
  /** Здесь человек работал в прошлый раз — подсказка, а не выбор за него. */
  isLast: boolean;
  busy: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const kind = point.isMain ? 'Основной сервис' : 'Филиал';
  // Дом = сам автосервис владельца, здание = открытый позже филиал. Те же
  // глифы, что в разделе «Филиалы», — одна сущность, один значок.
  const Icon = point.isMain ? Home : Building2;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      aria-label={`Войти: ${point.name}, ${kind.toLowerCase()}${point.address ? `, ${point.address}` : ''}${
        isLast ? '. Здесь вы работали в прошлый раз' : ''
      }`}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3.5 text-left shadow-card transition-[border-color,background-color,box-shadow] duration-150',
        disabled ? 'opacity-50' : 'hover:border-accent/40 hover:bg-accent-soft/40 hover:shadow-pop',
        focusRing,
      )}
    >
      <span className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg', toneChip.accent)}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-md font-semibold text-ink">{point.name}</span>
          {isLast && (
            <Badge tone="accent" size="sm">
              Были здесь
            </Badge>
          )}
        </span>
        <span className="mt-0.5 block truncate text-xs text-ink-3">
          {point.address ? `${kind} · ${point.address}` : kind}
        </span>
      </span>
      {busy ? (
        <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-accent" aria-hidden="true" />
      ) : (
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />
      )}
    </button>
  );
}
