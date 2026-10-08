let currentIdentity: string | null = null;
let currentGeneration = 0;

export function captureNfcSessionGeneration(identity: string) {
  if (currentIdentity !== identity) {
    currentIdentity = identity;
    currentGeneration += 1;
  }
  const generation = currentGeneration;
  return {
    id: String(generation),
    isCurrent: () => currentIdentity === identity && currentGeneration === generation,
  };
}
