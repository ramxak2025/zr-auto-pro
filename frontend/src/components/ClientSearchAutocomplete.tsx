import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, User, UserCheck, Loader2, X } from 'lucide-react';
import { clientsApi } from '../api/services';
import type { Client } from '../types';
import { formatPhone } from '../../../shared/validation/phone';
import { cn } from '../ui/cn';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { focusRing } from '../ui/tokens';

/**
 * ClientSearchAutocomplete — reusable client picker used by the «Сменить
 * владельца» flows (client card + Касса) and the car edit modal in
 * ClientDetailPage. Debounce-free: React Query already dedupes and caches the
 * `['clients', { search, limit }]` key, and the list is filtered client-side
 * by `excludeClientId` so the current owner never appears as a target.
 *
 * Behaviour (unchanged from the original inline copy in ClientDetailPage):
 * - типит ≥1 символ → dropdown с результатами (имя / телефон);
 * - выбор клиента → компактная карточка с кнопкой «Сбросить»;
 * - клик вне — закрывает dropdown. ↑/↓ + Enter — выбор с клавиатуры.
 */
export default function ClientSearchAutocomplete({
  selectedClient,
  onSelect,
  excludeClientId,
  placeholder = 'Имя или телефон клиента…',
}: {
  selectedClient: Client | null;
  onSelect: (client: Client | null) => void;
  excludeClientId?: string;
  placeholder?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    data: clientsData,
    isLoading,
    isError,
    refetch,
  } = useQuery<{ data: Client[] }>({
    queryKey: ['clients', { search, limit: 10 }],
    queryFn: async () => {
      const res = await clientsApi.getAll({ search, limit: 10 });
      return res.data;
    },
    enabled: search.length >= 1,
  });

  const clients: Client[] = (clientsData?.data || []).filter((c) => c.id !== excludeClientId);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (client: Client) => {
    onSelect(client);
    setSearch('');
    setIsOpen(false);
  };

  const handleClear = () => {
    onSelect(null);
    setSearch('');
  };

  if (selectedClient) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-accent/30 bg-accent-soft p-3">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-surface text-accent">
          <UserCheck className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{selectedClient.fullName}</p>
          <p className="text-xs text-ink-3">{formatPhone(selectedClient.phone)}</p>
        </div>
        <Button variant="ghost" size="sm" icon={X} onClick={handleClear}>
          Сбросить
        </Button>
      </div>
    );
  }

  const open = isOpen && search.length >= 1;
  const activeId = open && clients[active] ? `${listId}-opt-${clients[active].id}` : undefined;

  return (
    <div ref={wrapperRef} className="relative">
      <Input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-label="Поиск клиента"
        autoComplete="off"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setActive(0);
          setIsOpen(true);
        }}
        onFocus={() => {
          if (search.length >= 1) setIsOpen(true);
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, Math.max(clients.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && clients[active]) {
            e.preventDefault();
            handleSelect(clients[active]);
          } else if (e.key === 'Escape') {
            setIsOpen(false);
          }
        }}
        leftIcon={Search}
        placeholder={placeholder}
      />

      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label="Найденные клиенты"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-pop motion-safe:animate-pop-in"
        >
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-ink-3" role="status">
              <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
              Поиск…
            </div>
          ) : isError ? (
            <div className="flex items-center justify-between gap-3 px-3 py-3 text-sm text-bad-text" role="alert">
              Не удалось найти клиентов
              <Button variant="secondary" size="sm" onClick={() => refetch()}>
                Повторить
              </Button>
            </div>
          ) : clients.length === 0 ? (
            <div className="py-4 text-center text-sm text-ink-3">Клиенты не найдены</div>
          ) : (
            clients.map((client, i) => (
              // Мышь: клик выбирает; клавиатура ведётся из поля (aria-activedescendant).
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events
              <div
                key={client.id}
                id={`${listId}-opt-${client.id}`}
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(client)}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                  i === active ? 'bg-surface-3' : 'hover:bg-surface-3',
                  focusRing,
                )}
              >
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink-3">
                  <User className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{client.fullName}</span>
                  <span className="block text-xs text-ink-3">{formatPhone(client.phone)}</span>
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
