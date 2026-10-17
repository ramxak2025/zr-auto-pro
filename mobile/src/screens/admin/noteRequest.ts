export interface NoteRequest {
  text: string;
  requestId: string;
}
/** Keep the UUID when a timeout leaves the write outcome unknown. */
export function prepareNoteRequest(text: string, previous: NoteRequest | null, uuid: () => string): NoteRequest {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 4000 || trimmed.includes('\0'))
    throw new Error('Заметка — от 1 до 4000 символов без NUL.');
  return previous?.text === trimmed ? previous : { text: trimmed, requestId: uuid() };
}
