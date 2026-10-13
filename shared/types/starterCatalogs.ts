export type StarterPart = 'services' | 'products' | 'templates';
export interface StarterDirection {
  id: string;
  name: string;
  description: string;
}
export interface StarterSelection {
  directionIds: string[];
  parts: StarterPart[];
  warehouseId?: string;
}
export interface StarterPreviewItem {
  key: string;
  kind: StarterPart | 'productFolders' | 'serviceFolders' | 'templateFolders';
  name: string;
  category: string;
  status: 'add' | 'reuse' | 'ambiguous' | 'deleted' | 'blocked';
  candidates: { id: string; name: string }[];
  dependencies?: string[];
  note?: string;
  brand?: string;
  article?: string;
  packaging?: string;
  unit?: string;
  sourceUrl?: string;
}
export interface StarterPreview {
  id: string;
  version: string;
  warehouseId: string;
  items: StarterPreviewItem[];
}
export interface StarterResolution {
  action: 'reuse' | 'separate' | 'skip' | 'restore';
  resourceId?: string;
}
export interface StarterInstallRequest {
  previewId: string;
  resolutions?: Record<string, StarterResolution>;
}
export interface StarterInstallResult {
  added: number;
  reused: number;
  skipped: number;
  restored: number;
}
