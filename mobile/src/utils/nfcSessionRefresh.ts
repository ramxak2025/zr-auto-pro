/** Refresh and write NFC status only into the captured session's query keys. */
export function createNfcSessionRefresh(
  api: { getMy: () => Promise<{ data: unknown }>; nfcStatus: () => Promise<{ data: unknown }> },
  queryClient: { setQueryData: (key: readonly unknown[], data: unknown) => unknown },
  isCurrent: () => boolean,
  statusKey: readonly unknown[],
): () => Promise<void> {
  return async () => {
    const [shifts, status] = await Promise.all([api.getMy(), api.nfcStatus()]);
    if (!isCurrent()) throw new Error('Session changed');
    queryClient.setQueryData(['shifts', 'my'], shifts.data);
    queryClient.setQueryData(statusKey, status.data);
  };
}
