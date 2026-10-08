/** Run the actual create-tag request lifecycle under an irreversible owner lease. */
export async function runNfcCreateTagOperation<T>(options: {
  request: () => Promise<T>;
  isCurrent: () => boolean;
  onSuccess: (result: T) => void;
  onError: () => void;
  onFinally: () => void;
}): Promise<void> {
  try {
    const result = await options.request();
    if (options.isCurrent()) options.onSuccess(result);
  } catch {
    if (options.isCurrent()) options.onError();
  } finally {
    if (options.isCurrent()) options.onFinally();
  }
}
