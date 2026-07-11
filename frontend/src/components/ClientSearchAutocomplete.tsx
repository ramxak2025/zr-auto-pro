import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, User, UserCheck, Loader2 } from 'lucide-react';
import { clientsApi } from '../api/services';
import type { Client } from '../types';
import { formatPhone } from '../../../shared/validation/phone';

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
 * - клик вне — закрывает dropdown.
 */
export default function ClientSearchAutocomplete({
  selectedClient,
  onSelect,
  excludeClientId,
}: {
  selectedClient: Client | null;
  onSelect: (client: Client | null) => void;
  excludeClientId?: string;
}) {
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: clientsData, isLoading } = useQuery<{ data: Client[] }>({
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
      <div className="flex items-center gap-3 p-3 bg-primary-50 rounded-xl border border-primary-200">
        <div className="p-1.5 bg-white rounded-lg">
          <UserCheck className="w-4 h-4 text-primary-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">{selectedClient.fullName}</p>
          <p className="text-xs text-gray-500">{formatPhone(selectedClient.phone)}</p>
        </div>
        <button
          type="button"
          onClick={handleClear}
          className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
        >
          Сбросить
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            if (search.length >= 1) setIsOpen(true);
          }}
          className="input pl-9"
          placeholder="Поиск клиента по имени или телефону..."
        />
      </div>

      {isOpen && search.length >= 1 && (
        <div className="absolute z-50 w-full mt-1 bg-white rounded-xl shadow-lg border border-gray-200 max-h-60 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
              <span className="ml-2 text-sm text-gray-500">Поиск...</span>
            </div>
          ) : clients.length === 0 ? (
            <div className="py-4 text-center text-sm text-gray-400">Клиенты не найдены</div>
          ) : (
            clients.map((client) => (
              <button
                key={client.id}
                type="button"
                onClick={() => handleSelect(client)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors first:rounded-t-xl last:rounded-b-xl"
              >
                <div className="p-1.5 bg-gray-100 rounded-lg">
                  <User className="w-4 h-4 text-gray-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{client.fullName}</p>
                  <p className="text-xs text-gray-500">{formatPhone(client.phone)}</p>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
