ALTER TABLE supplier_invoice_ocr_attempts ADD COLUMN content_hash TEXT;
UPDATE supplier_invoice_ocr_attempts a SET content_hash=d.document_hash FROM supplier_invoice_documents d
  WHERE a.document_id=d.id AND a.tenant_id=d.tenant_id AND d.document_hash IS NOT NULL;
CREATE INDEX supplier_invoice_attempt_content ON supplier_invoice_ocr_attempts(tenant_id,content_hash);
