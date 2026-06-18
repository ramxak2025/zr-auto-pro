-- Customer returns into the warehouse get their OWN stock_movements type so the
-- journal («Складские документы») can classify them as «Возврат клиента» instead
-- of misreporting them as a supplier «Поступление/Покупки».
--
-- Background: a customer return to the main warehouse (returns.service.ts,
-- destination='warehouse') used to write the stock row as type='income' — the
-- same type a supplier delivery uses — so the journal showed it under «Покупки».
-- We introduce a distinct `customer_return` type. Stock still increments exactly
-- as before (the return adds the goods back); only the type label changes, so the
-- journal can tell a customer return apart from a supplier purchase.
--
-- The CHECK constraint on stock_movements.type was last (re)created in
-- 030_stock_movements_v2.sql as the named constraint `stock_movements_type_chk`.
-- We drop whatever type-CHECK currently exists (name is version-dependent for the
-- original inline one) and re-add the named constraint WITH the new value. Fully
-- idempotent: safe to run on a DB that already has the expanded set.

DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'stock_movements'::regclass
     AND contype  = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%type%';

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE stock_movements DROP CONSTRAINT %I', cname);
  END IF;
END$$;

DO $$ BEGIN
  ALTER TABLE stock_movements
    ADD CONSTRAINT stock_movements_type_chk
    CHECK (type IN (
      'inventory',
      'writeoff',
      'income',
      'expense',
      'defect_transfer',
      'used_transfer',
      'defect_return_to_supplier',
      'customer_return'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
