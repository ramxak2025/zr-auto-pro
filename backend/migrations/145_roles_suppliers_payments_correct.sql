-- 145_roles_suppliers_payments_correct.sql
-- ============================================================================
-- Новая ячейка матрицы ролей: suppliers.paymentsCorrect →
-- suppliers_payments_correct — «Корректирует платежи поставщикам» (Round 14,
-- зона 2). Гейтит POST /suppliers/payments/:id/reverse (сторно платежа) и
-- POST /suppliers/payments/refund (возврат денег от поставщика).
--
-- Решение владельца: отдельная ГАЛКА, по умолчанию только owner-класс.
-- suppliers.manage НЕ влечёт paymentsCorrect (в отличие от manage ⇒ view):
-- право корректировать деньги выдаётся явно.
--
-- Сиды системных ролей:
--   «Мастер»        — false (мастер и так без доступа к поставщикам);
--   «Администратор» — false (owner-only действие, как salary.payouts /
--                     equipment.permanentDelete / settings.company — сид 136);
--   «Директор»      — true (owner-class обходит гейты по строковой роли;
--                     матрица декоративна, но редактор её показывает).
--
-- Кастомные роли (system_key IS NULL) НЕ трогаются: отсутствующая ячейка
-- читается сервером как false (fail-closed) — владелец включает галку сам.
--
-- Идемпотентность: каждая ячейка — jsonb_set под guard'ом «ячейка ещё не
-- задана» (matrix #> path IS NULL) → повторный прогон no-op, ручные правки
-- владельца не перетираются. Секция suppliers гарантируется COALESCE-мержем.
--
-- WHERE system_key = '...' покрывает И глобальные шаблоны (tenant_id IS NULL),
-- И тенантные override'ы — до этой миграции действия не существовало, т.е.
-- сеять дефолт корректно для обоих.
--
-- RLS (конвенция 131/134/136/137): roles под RLS (114). Миграции идут
-- admin-пулом (суперпользователь, RLS обходится); row_security = off —
-- fail-loud страховка.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL row_security = off;

-- ── 0. Страховка: matrix NULL → '{}' (jsonb_set(NULL, …) вернул бы NULL и
--       молча потерял бы всю матрицу).
UPDATE roles SET matrix = '{}'::jsonb
 WHERE system_key IN ('master', 'admin', 'director') AND matrix IS NULL;

-- ── 1. Гарантировать существование секции suppliers (двухуровневый jsonb_set
--       в отсутствующую секцию — no-op, поэтому сперва создаём секцию как {}).
UPDATE roles SET matrix = jsonb_set(matrix, '{suppliers}', COALESCE(matrix -> 'suppliers', '{}'::jsonb), true)
 WHERE system_key IN ('master', 'admin', 'director') AND matrix -> 'suppliers' IS NULL;

-- ── 2. «Мастер» — false.
UPDATE roles SET matrix = jsonb_set(matrix, '{suppliers,paymentsCorrect}', 'false'::jsonb, true)
 WHERE system_key = 'master' AND matrix #> '{suppliers,paymentsCorrect}' IS NULL;

-- ── 3. «Администратор» — false (owner-only действие).
UPDATE roles SET matrix = jsonb_set(matrix, '{suppliers,paymentsCorrect}', 'false'::jsonb, true)
 WHERE system_key = 'admin' AND matrix #> '{suppliers,paymentsCorrect}' IS NULL;

-- ── 4. «Директор» — true.
UPDATE roles SET matrix = jsonb_set(matrix, '{suppliers,paymentsCorrect}', 'true'::jsonb, true)
 WHERE system_key = 'director' AND matrix #> '{suppliers,paymentsCorrect}' IS NULL;
