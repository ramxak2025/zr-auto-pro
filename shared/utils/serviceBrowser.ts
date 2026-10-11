import type { Service, ServiceFolder } from '../types';
import { normalizeServiceCategoryPath } from './normalizeServiceCategoryPath';

/** Search deliberately ignores the current folder; counts use the complete catalog. */
export function serviceBrowserLevel(
  services: Service[],
  explicitFolders: ServiceFolder[],
  path: string[],
  search: string,
) {
  const folderCounts = new Map<string, number>();
  const currentServices: Service[] = [];
  const query = search.trim().toLocaleLowerCase('ru');
  if (query)
    return {
      folders: [] as [string, number][],
      currentServices: services.filter((service) =>
        `${service.name} ${service.category ?? ''}`.toLocaleLowerCase('ru').includes(query),
      ),
    };
  const addFolder = (parts: string[], increment: number) => {
    if (path.some((part, index) => parts[index] !== part) || parts.length <= path.length) return;
    const name = parts[path.length];
    folderCounts.set(name, (folderCounts.get(name) ?? 0) + increment);
  };
  for (const folder of explicitFolders) addFolder(folder.path.split('/'), 0);
  for (const service of services) {
    const parts = normalizeServiceCategoryPath(service.category ?? '')
      .split('/')
      .filter(Boolean);
    if (path.some((part, index) => parts[index] !== part)) continue;
    if (parts.length > path.length) addFolder(parts, 1);
    else currentServices.push(service);
  }
  return { folders: [...folderCounts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru')), currentServices };
}
