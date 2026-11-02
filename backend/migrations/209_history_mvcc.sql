-- Nullable metadata first, then a default for FUTURE rows only. No rewrite or
-- invented backfill: old NULL rows committed before these DDL locks completed.
ALTER TABLE stock_movements ADD COLUMN recorded_xid xid8;
ALTER TABLE stock_movements ALTER COLUMN recorded_xid SET DEFAULT pg_current_xact_id();
ALTER TABLE check_product_events ADD COLUMN recorded_xid xid8;
ALTER TABLE check_product_events ALTER COLUMN recorded_xid SET DEFAULT pg_current_xact_id();
ALTER TABLE check_product_lines ADD COLUMN recorded_xid xid8;
ALTER TABLE check_product_lines ALTER COLUMN recorded_xid SET DEFAULT pg_current_xact_id();
ALTER TABLE checks ADD COLUMN history_created_xid xid8;
ALTER TABLE checks ALTER COLUMN history_created_xid SET DEFAULT pg_current_xact_id();

-- A transfer remains ONE operation/row. Capture the receiving position rather
-- than guessing it later from mutable/ambiguous product names.
ALTER TABLE stock_movements ADD COLUMN target_product_id UUID;
ALTER TABLE stock_movements ADD COLUMN target_stock_before NUMERIC(12,3);
ALTER TABLE stock_movements ADD COLUMN target_stock_after NUMERIC(12,3);
CREATE INDEX stock_movements_target_history ON stock_movements(tenant_id,target_product_id,created_at DESC,id DESC)
  WHERE target_product_id IS NOT NULL;

CREATE FUNCTION append_stock_history_invalidation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tid UUID; BEGIN
  IF TG_OP='DELETE' THEN tid:=OLD.tenant_id; ELSE
    tid:=NEW.tenant_id;
    -- Changes made before a freshly inserted event commits cannot invalidate a
    -- prior event-set snapshot: its top-level XID is already excluded.
    IF NEW.recorded_xid=pg_current_xact_id() THEN RETURN NEW; END IF;
  END IF;
  IF tid IS NOT NULL AND EXISTS(SELECT 1 FROM tenants WHERE id=tid) THEN
    INSERT INTO stock_history_changes(tenant_id) VALUES(tid);
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER stock_history_mutated AFTER UPDATE OF created_at,product_id,type,quantity,stock_before,stock_after,
  warehouse_id,source_warehouse_id,target_warehouse_id,source_product_id,target_product_id,target_stock_before,target_stock_after
  ON stock_movements FOR EACH ROW
  WHEN (ROW(OLD.created_at,OLD.product_id,OLD.type,OLD.quantity,OLD.stock_before,OLD.stock_after,OLD.warehouse_id,OLD.source_warehouse_id,OLD.target_warehouse_id,OLD.source_product_id,OLD.target_product_id,OLD.target_stock_before,OLD.target_stock_after)
    IS DISTINCT FROM ROW(NEW.created_at,NEW.product_id,NEW.type,NEW.quantity,NEW.stock_before,NEW.stock_after,NEW.warehouse_id,NEW.source_warehouse_id,NEW.target_warehouse_id,NEW.source_product_id,NEW.target_product_id,NEW.target_stock_before,NEW.target_stock_after))
  EXECUTE FUNCTION append_stock_history_invalidation();
CREATE TRIGGER stock_history_deleted AFTER DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION append_stock_history_invalidation();
CREATE TRIGGER check_product_event_mutated AFTER UPDATE ON check_product_events FOR EACH ROW EXECUTE FUNCTION append_stock_history_invalidation();
CREATE TRIGGER check_product_event_deleted AFTER DELETE ON check_product_events FOR EACH ROW EXECUTE FUNCTION append_stock_history_invalidation();

CREATE FUNCTION invalidate_check_history_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tid UUID; BEGIN
  IF TG_OP='DELETE' THEN tid:=OLD.tenant_id;
  ELSE
    tid:=NEW.tenant_id;
    IF NEW.history_created_xid=pg_current_xact_id() THEN RETURN NEW; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM tenants WHERE id=tid) THEN INSERT INTO stock_history_changes(tenant_id) VALUES(tid); END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER check_history_owner_changed AFTER UPDATE OF master_id ON checks FOR EACH ROW
  WHEN(OLD.master_id IS DISTINCT FROM NEW.master_id) EXECUTE FUNCTION invalidate_check_history_identity();
CREATE TRIGGER check_history_deleted AFTER DELETE ON checks FOR EACH ROW EXECUTE FUNCTION invalidate_check_history_identity();

-- Receipt executor/assignee membership is part of checks_view_all's own scope.
-- Replace-all writes on an existing receipt conservatively require a refresh;
-- initial rows of a new receipt never invalidate ongoing pagination.
CREATE FUNCTION invalidate_check_history_membership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cid UUID; parent checks%ROWTYPE; BEGIN
  IF TG_OP='DELETE' THEN cid:=OLD.check_id; ELSE cid:=NEW.check_id; END IF;
  SELECT * INTO parent FROM checks WHERE id=cid;
  IF NOT FOUND OR parent.history_created_xid=pg_current_xact_id() THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM tenants WHERE id=parent.tenant_id) THEN
    INSERT INTO stock_history_changes(tenant_id) VALUES(parent.tenant_id);
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER check_history_service_member_insert AFTER INSERT ON check_service_lines FOR EACH ROW EXECUTE FUNCTION invalidate_check_history_membership();
CREATE TRIGGER check_history_service_member_delete AFTER DELETE ON check_service_lines FOR EACH ROW EXECUTE FUNCTION invalidate_check_history_membership();
CREATE TRIGGER check_history_service_member_update AFTER UPDATE OF master_id ON check_service_lines FOR EACH ROW
  WHEN(OLD.master_id IS DISTINCT FROM NEW.master_id) EXECUTE FUNCTION invalidate_check_history_membership();
CREATE TRIGGER check_history_assignee_insert AFTER INSERT ON check_assignees FOR EACH ROW EXECUTE FUNCTION invalidate_check_history_membership();
CREATE TRIGGER check_history_assignee_delete AFTER DELETE ON check_assignees FOR EACH ROW EXECUTE FUNCTION invalidate_check_history_membership();

CREATE FUNCTION invalidate_legacy_check_product_lines() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cid UUID; parent checks%ROWTYPE; BEGIN
  IF TG_OP='DELETE' THEN cid:=OLD.check_id; ELSE cid:=NEW.check_id; END IF;
  SELECT * INTO parent FROM checks WHERE id=cid;
  IF FOUND AND parent.product_history_version=0 AND parent.is_deferred=false
    AND parent.history_created_xid IS DISTINCT FROM pg_current_xact_id() THEN
    INSERT INTO stock_history_changes(tenant_id) VALUES(parent.tenant_id);
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER legacy_check_product_history_insert AFTER INSERT ON check_product_lines FOR EACH ROW EXECUTE FUNCTION invalidate_legacy_check_product_lines();
CREATE TRIGGER legacy_check_product_history_update AFTER UPDATE ON check_product_lines FOR EACH ROW EXECUTE FUNCTION invalidate_legacy_check_product_lines();
CREATE TRIGGER legacy_check_product_history_delete AFTER DELETE ON check_product_lines FOR EACH ROW EXECUTE FUNCTION invalidate_legacy_check_product_lines();

CREATE FUNCTION invalidate_warehouse_history_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  INSERT INTO stock_history_changes(tenant_id) VALUES(NEW.tenant_id);RETURN NEW;
END $$;
CREATE TRIGGER warehouse_history_point_changed AFTER UPDATE OF point_id ON warehouses FOR EACH ROW
  WHEN(OLD.point_id IS DISTINCT FROM NEW.point_id) EXECUTE FUNCTION invalidate_warehouse_history_scope();

-- Only uncovered sales still depend on the product's current warehouse.
CREATE FUNCTION invalidate_legacy_product_history_place() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF EXISTS(SELECT 1 FROM check_product_lines l JOIN checks c ON c.id=l.check_id
    WHERE l.product_id=NEW.id AND c.tenant_id=NEW.tenant_id AND c.product_history_version=0) THEN
    INSERT INTO stock_history_changes(tenant_id) VALUES(NEW.tenant_id);
  END IF; RETURN NEW;
END $$;
CREATE TRIGGER legacy_product_history_place_changed AFTER UPDATE OF warehouse_id ON products FOR EACH ROW
  WHEN(OLD.warehouse_id IS DISTINCT FROM NEW.warehouse_id) EXECUTE FUNCTION invalidate_legacy_product_history_place();
