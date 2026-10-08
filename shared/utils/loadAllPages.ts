/** Fetch every page from a standard `{ data, total }` list endpoint. */
export async function loadAllPages<T>(
  fetchPage: (page: number, limit: number) => Promise<{ data: T[]; total: number } | T[]>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; ; page += 1) {
    const result = await fetchPage(page, pageSize);
    const items = Array.isArray(result) ? result : result.data;
    const total = Array.isArray(result) ? undefined : result.total;
    all.push(...items);
    if (items.length === 0 || items.length < pageSize || (total !== undefined && all.length >= total)) return all;
  }
}
