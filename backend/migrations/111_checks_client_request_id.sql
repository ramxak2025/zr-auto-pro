-- 111_checks_client_request_id.sql
-- Round 9, шаг 1: серверная идемпотентность создания чека (фундамент
-- офлайн-очереди мобилки).
--
-- PROBLEM: сеть в сервисе владельца нестабильна. Мобилка будет ставить чеки в
-- офлайн-очередь и ПОВТОРЯТЬ отправку. Без серверного dedup ретрай после
-- полудоставленного запроса (ответ потерялся, чек уже создан) создаёт ВТОРОЙ
-- чек — двойное списание стока, двойная зарплата, двойная выручка.
--
-- FIX: клиент генерирует UUID (clientRequestId) один раз на логический чек и
-- шлёт его с каждым ретраем. Сервер хранит его в checks.client_request_id;
-- частичный уникальный индекс (tenant_id, client_request_id) — DB-гарантия
-- «максимум один чек на ключ». ChecksService.create(): pre-check по ключу
-- возвращает уже созданный чек, а гонка двух конкурентных ретраев ловится по
-- 23505 на этом индексе → проигравший откатывается и читает чек победителя.
--
-- BACKWARD COMPATIBLE: колонка NULLable, у всех существующих чеков NULL.
-- Частичный индекс (WHERE client_request_id IS NOT NULL) не накладывает
-- никаких ограничений на NULL-строки — путь создания без ключа байт-в-байт
-- прежний. Ничего не переписываем, только ALTER ADD + CREATE INDEX.
--
-- Idempotent: IF NOT EXISTS на обоих statement'ах.

ALTER TABLE checks ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_checks_client_request
  ON checks (tenant_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
