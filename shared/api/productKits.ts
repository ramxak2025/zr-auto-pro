export interface KitComponentInput { productId: string; quantity: number }
/** Composition only; prices and acquisition basis belong to each physical batch. */
export interface KitRecipe { id: string; name: string; version: number; components: KitComponentInput[] }
export interface AssembleKitRequest {
  requestId: string; name: string; quantity: number; sellPrice: number; components: KitComponentInput[];
  warehouseId?: string; category?: string; storageCellId?: string; recipeId?: string;
  /** Explicit immutable version, including an older version pinned by a POS template. */
  recipeVersion?: number;
  /** Existing latest-version CAS contract, retained for older assembly clients. */
  expectedRecipeVersion?: number;
}
export interface KitOperationResult {
  productId: string; assemblyId: string; revision: number; quantity: number; costPrice: number;
  sellPrice: number; operationId: string; recipeId: string; recipeVersion: number;
}
export interface PhysicalProductKit {
  id: string; productId: string; name: string; revision: number; quantity: number; assembledQuantity: number;
  sellPrice: number; costPrice?: number; warehouseId: string; recipeId: string; recipeVersion: number;
  createdBy: string; createdAt: string;
  components: Array<{ productId: string; name: string; quantity: number; costPrice?: number; warehouseId: string; category: string | null; storageCellId: string | null }>;
}
/** A template pins composition; applying it always selects concrete batch lines. */
export interface TemplateKitResolution {
  status: 'resolved' | 'selection_required' | 'shortage' | 'unavailable';
  availableQuantity: number;
  candidates: Array<{
    productId: string; assemblyId: string; revision: number; quantity: number; name: string; sellPrice: number;
    warehouseId: string; costPrice?: number;
  }>;
}
/** Draft-only intention; conversion occurs once, atomically on confirmed sale. */
export interface KitSplitIntent { intentId: string; productId: string; expectedRevision: number; quantity: number }
/** Original source SKU from the captured assembly, even when its current row moved. */
export interface KitSourceReference { intentId: string; sourceProductId: string }
