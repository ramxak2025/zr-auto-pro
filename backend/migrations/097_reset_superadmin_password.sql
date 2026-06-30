-- 097_reset_superadmin_password.sql
-- One-time superadmin password reset (owner request, 2026-06-30).
--
-- Only the bcryptjs hash is stored here — the plaintext is never committed or
-- logged. The hash was generated with bcryptjs cost 12 (matching auth.service
-- `bcrypt.hash(password, 12)`) and self-verified with bcrypt.compare before
-- embedding (same established pattern as the demo-account hash in 094).
--
-- Scoped to role = 'superadmin' (the single platform owner account). Runs once
-- via MigrationRunner; re-running would set the same hash (safe/idempotent).
UPDATE users
SET password = '$2a$12$iaIO4wTNexZ7ESLp6NdRUO3NJvnnnfhduC.BFNiGSKil9ueTQbntu'
WHERE role = 'superadmin';
