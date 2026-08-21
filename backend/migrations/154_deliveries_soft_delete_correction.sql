-- 154_deliveries_soft_delete_correction.sql
-- ============================================================================
-- Поставки поставщиков: пометка «удалена» вместо исчезновения + след
-- корректировок (правка строк/цен существующей поставки).
--
-- Требование владельца (2026-08): «если удаляю поставку, она должна быть
-- помечена как удалённая, а не просто исчезать» + «поставку можно открыть и
-- внести корректировки».
--
--   • deleted_at / deleted_by / delete_reason — soft-delete по образцу корзины
--     чеков (106): строка остаётся в истории навсегда, UI рисует бейдж
--     «Удалена» (паттерн сторно-платежа 144). Откат остатков склада и долга
--     поставщику делает сервис в той же транзакции корректирующими
--     stock_movements — миграция данные не трогает.
--   • corrected_at / corrected_by — метка последней корректировки поставки
--     (кто и когда правил), по образцу supplier_payments (144).
--
-- ADDITIVE и идемпотентно: ADD COLUMN IF NOT EXISTS + partial index
-- IF NOT EXISTS. Существующие строки получают deleted_at = NULL — поведение
-- всех текущих запросов не меняется. Никогда не редактируется после применения.
-- ============================================================================

ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS delete_reason TEXT;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMPTZ;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS corrected_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Выборка удалённых поставок тенанта (история / аудит) без скана живых строк.
CREATE INDEX IF NOT EXISTS idx_deliveries_trash
    ON deliveries (tenant_id, deleted_at DESC)
    WHERE deleted_at IS NOT NULL;
