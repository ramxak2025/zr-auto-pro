/** Classify only native error markers; never expose an error message, key or value. */
export function storageWriteFailureKind(error: unknown): 'capacity' | 'native_write' | 'other' {
  // AsyncStorage.multiSet rejects Error[], whereas setItem rejects one Error.
  // Every failure must be understood before cache eviction is permitted.
  if (Array.isArray(error)) {
    if (!error.length) return 'other';
    const kinds = error.map(singleStorageFailureKind);
    if (kinds.includes('other')) return 'other';
    return kinds.every((kind) => kind === 'capacity') ? 'capacity' : 'native_write';
  }
  return singleStorageFailureKind(error);
}

function singleStorageFailureKind(error: unknown): 'capacity' | 'native_write' | 'other' {
  const source = error as { code?: unknown; name?: unknown; message?: unknown } | null;
  const code = typeof source?.code === 'string' ? source.code : '';
  const message = typeof source?.message === 'string' ? source.message : '';
  if (
    ['SQLITE_FULL', 'ENOSPC', 'NSFileWriteOutOfSpaceError'].includes(code) ||
    source?.name === 'QuotaExceededError' ||
    /\bSQLITE_FULL\b|database or disk is full|disk full|no space left on device|quota exceeded/i.test(message)
  )
    return 'capacity';
  // AsyncStorage 2.2 on iOS discards NSError details in convertError(), leaving
  // exactly these messages. Permit one cache eviction/retry, not an unbounded GC.
  if (/^Failed to write (?:value|manifest file)\.$/.test(message)) return 'native_write';
  return 'other';
}
