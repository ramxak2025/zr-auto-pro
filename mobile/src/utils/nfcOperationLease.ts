export function createNfcOperationLeaseController() {
  let generation = 0;
  return {
    begin(isOwnerCurrent: () => boolean) {
      const operationGeneration = ++generation;
      return { isCurrent: () => operationGeneration === generation && isOwnerCurrent() };
    },
    invalidate() {
      generation += 1;
    },
  };
}
