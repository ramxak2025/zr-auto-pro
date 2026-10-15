/** Validate a new folder segment; imported catalog paths are left untouched. */
export function newCatalogFolderPath(parentPath: string, rawName: string): string {
  const name = rawName.trim();
  if (!name) throw new Error('Введите название папки.');
  if (name.includes('/')) throw new Error('Введите одно название без «/». Подпапку создайте внутри папки.');
  if (name === '.' || name === '..') throw new Error('Выберите другое название папки.');
  const path = parentPath ? `${parentPath}/${name}` : name;
  if (path.length > 256) throw new Error('Название слишком длинное: путь к папке должен быть не длиннее 256 символов.');
  return path;
}
