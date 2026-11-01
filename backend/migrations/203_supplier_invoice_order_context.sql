ALTER TABLE supplier_invoice_documents ADD COLUMN purchase_order_id UUID REFERENCES purchase_orders(id);
ALTER TABLE supplier_invoice_documents ADD COLUMN document_date DATE;
