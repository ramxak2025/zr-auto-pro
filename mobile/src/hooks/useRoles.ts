/**
 * useRoles — единый источник правды для списка ролей (Bitrix24-style, 114).
 *
 * Тот же урок, что в hooks/useUsers.ts: в ключ ['roles'] пишут НЕСКОЛЬКО
 * экранов (RolesScreen, RoleEditorScreen, шит выбора роли в UsersScreen).
 * `queryFn` не входит в ключ кэша → если бы один экран клал в слот сырой
 * AxiosResponse, а другой массив, читатели ломались бы в зависимости от того,
 * кто писал последним. Поэтому ОДНА queryFn, которая всегда отдаёт `Role[]`.
 *
 * Сервер: GET /roles — director/admin/superadmin-gated (см. roles.controller);
 * возвращает системные + свои роли (is_system DESC, sort). Экраны обязаны
 * передавать `enabled` = owner-class-гейт, чтобы master с user_management не
 * ловил бесполезный 403.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { rolesApi } from '../api/services';
import type { Role } from '../../../shared/types';

/** Канонический ключ списка ролей. Инвалидируется после create/update/remove. */
export const ROLES_QUERY_KEY = ['roles'] as const;

/**
 * Привести любое значение из кэша к `Role[]` — кривая форма деградирует в
 * `[]`, а не роняет `.filter`/`.find` ниже по коду.
 */
export function toRoleArray(value: unknown): Role[] {
  return Array.isArray(value) ? (value as Role[]) : [];
}

/** Единственная queryFn ключа ['roles'] — всегда массив. */
async function fetchRoles(): Promise<Role[]> {
  const res = await rolesApi.list();
  return toRoleArray(res.data);
}

/**
 * Список ролей (системные + свои). `enabled` — вызывающий экран передаёт свой
 * owner-class-гейт (director/admin/superadmin). SWR через `placeholderData` —
 * список не мигает пустотой при фоновом рефетче; `staleTime` 5 мин — роли
 * меняются редко (справочник, как ['users']).
 */
export function useRoles(enabled: boolean): UseQueryResult<Role[]> {
  return useQuery<Role[]>({
    queryKey: ROLES_QUERY_KEY,
    queryFn: fetchRoles,
    enabled,
    placeholderData: (prev) => prev,
    staleTime: 5 * 60_000,
  });
}
