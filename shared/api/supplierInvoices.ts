/** Private OCR preview. No stock or supplier debt changes before confirm. */
export interface SupplierInvoiceLine {
  id: string;
  name: string;
  sku: string;
  unit: string;
  quantity: number | null;
  /** Purchase price per unit, never a line total. */
  price: number | null;
  productId: string | null;
  suggestedProductId: string | null;
  warnings: string[];
  quantityRaw?: string;
  priceRaw?: string;
  productUnit?: string;
  unitMismatch?: boolean;
  unitConfirmed?: boolean;
  confirmedQuantity?: number;
  confirmedPrice?: number;
}

export interface SupplierInvoiceDocument {
  id: string;
  supplierId: string;
  version: number;
  status: 'draft' | 'processing' | 'review' | 'error' | 'duplicate' | 'confirmed';
  date: string | null;
  orderId: string | null;
  comparison: null | {
    orderId: string;
    status: string;
    items: Array<{
      orderItemId: string;
      productId: string;
      name: string;
      orderedQuantity: number;
      outstandingQuantity: number;
      price: number;
    }>;
    lines: Array<{
      lineId: string;
      orderItemId: string | null;
      orderedQuantity: number | null;
      outstandingQuantity: number | null;
      orderedPrice: number | null;
      markers: string[];
    }>;
    missingOrderItemIds: string[];
  };
  pages: Array<{ id: string; index: number; url: string }>;
  lines: SupplierInvoiceLine[];
  warnings: string[];
  deliveryId: string | null;
  duplicateOf: string | null;
  errorCode: string | null;
}

export interface ConfirmSupplierInvoice {
  expectedVersion: number;
  requestId: string;
  /** Document date only; does not backdate inventory. */
  date: string;
  /** Omit for current receipt time. Explicit historical receipt date only. */
  receivedAt?: string;
  comment?: string;
  items: Array<{
    lineId: string;
    productId: string;
    quantity: number;
    price: number;
    sellPrice?: number;
    orderItemId?: string;
    unitConfirmed?: boolean;
    productUnit?: string;
  }>;
}
