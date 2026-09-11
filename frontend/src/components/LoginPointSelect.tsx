import { ArrowLeft, Building2, ChevronRight, Home, Loader2 } from 'lucide-react';
import type { LoginPointOption } from '../../../shared/api/types';

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
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          aria-label="Назад, к вводу телефона и пароля"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600 transition-colors hover:bg-gray-200 disabled:opacity-40"
        >
          <ArrowLeft className="h-[18px] w-[18px]" />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-gray-900">Выберите филиал</h1>
          <p className="text-xs text-gray-500">Куда вы заходите работать</p>
        </div>
      </div>

      {/* Честное объяснение ПРАВИЛА, а не украшение: человек должен узнать про
          «выйти и войти» здесь, а не когда будет искать переключатель. */}
      <p className="mb-5 text-sm leading-relaxed text-gray-600">
        Вы войдёте в один филиал — вся касса, склад и зарплата смены будут его. Чтобы работать в другом, нужно выйти и
        войти заново.
      </p>

      <div className="space-y-3">
        {points.map((point) => (
          <PointRow
            key={point.id}
            point={point}
            isLast={point.id === defaultPointId}
            busy={submittingPointId === point.id}
            // Второй клик по второй карточке, пока летит первый обмен, сжёг бы
            // одноразовый токен: сервер ответил бы «Выбор филиала уже
            // использован», и человек начинал бы вход заново на ровном месте.
            disabled={busy && submittingPointId !== point.id}
            onSelect={() => onSelect(point.id)}
          />
        ))}
      </div>
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
      aria-label={`Войти: ${point.name}, ${kind.toLowerCase()}${point.address ? `, ${point.address}` : ''}${
        isLast ? '. Здесь вы работали в прошлый раз' : ''
      }`}
      className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-4 text-left transition-all ${
        disabled
          ? 'border-gray-200 bg-white opacity-50'
          : 'border-gray-200 bg-white hover:border-primary-300 hover:bg-primary-50/40 active:scale-[0.99]'
      }`}
    >
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[15px] font-bold text-gray-900">{point.name}</span>
          {isLast && (
            <span className="flex-shrink-0 rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-bold text-primary-600">
              Были здесь
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-xs text-gray-500">
          {point.address ? `${kind} · ${point.address}` : kind}
        </span>
      </span>
      {busy ? (
        <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-primary-600" />
      ) : (
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-400" />
      )}
    </button>
  );
}
