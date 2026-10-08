let currentIdentity: string | null = null;
let currentGeneration = 0;

export function captureNfcSessionGeneration(identity: string) {
  if (currentIdentity !== identity) {
    currentIdentity = identity;
    currentGeneration += 1;
  }
  const generation = currentGeneration;
  const dataLease = captureDataSession();
  return {
    id: `${generation}:${dataLease.generation}`,
    isCurrent: () => dataLease.isCurrent() && currentIdentity === identity && currentGeneration === generation,
  };
}
import { captureDataSession } from '../contexts/dataSession';
