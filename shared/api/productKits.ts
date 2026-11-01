export interface KitComponentInput {productId:string;quantity:number}
export interface KitRecipe {id:string;name:string;version:number;components:KitComponentInput[]}
export interface AssembleKitRequest {
  requestId:string;name:string;quantity:number;sellPrice:number;components:KitComponentInput[];
  warehouseId?:string;category?:string;storageCellId?:string;recipeId?:string;expectedRecipeVersion?:number;
}
export interface KitOperationResult {productId:string;assemblyId:string;revision:number;quantity:number;costPrice:number;sellPrice:number;operationId:string}
export interface PhysicalProductKit {
  id:string;productId:string;name:string;revision:number;quantity:number;assembledQuantity:number;
  sellPrice:number;costPrice?:number;warehouseId:string;recipeId:string|null;createdBy:string;createdAt:string;
  components:Array<{productId:string;name:string;quantity:number;costPrice?:number;warehouseId:string;category:string|null;storageCellId:string|null}>;
}
/** Draft-only intention; conversion occurs once, atomically on confirmed sale. */
export interface KitSplitIntent {intentId:string;productId:string;expectedRevision:number;quantity:number}
/** Original source SKU from the captured assembly, even when its current row moved. */
export interface KitSourceReference {intentId:string;sourceProductId:string}
