export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
}

export function transformKeys(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(transformKeys);
  if (obj instanceof Date) return obj;
  if (typeof obj !== 'object') return obj;
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    result[snakeToCamel(key)] = value;
  }
  return result;
}

export function stripFields(obj: any, fields: string[]): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((item) => stripFields(item, fields));
  const result = { ...obj };
  for (const f of fields) {
    delete result[f];
  }
  return result;
}
