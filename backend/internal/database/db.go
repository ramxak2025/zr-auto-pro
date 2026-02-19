package database

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

var DB *sql.DB

func Connect() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://postgres:postgres@postgres:5432/zr_auto_pro?sslmode=disable"
	}

	var err error
	for i := 0; i < 30; i++ {
		DB, err = sql.Open("postgres", dsn)
		if err == nil {
			err = DB.Ping()
		}
		if err == nil {
			break
		}
		log.Printf("Waiting for database... attempt %d/30", i+1)
		time.Sleep(2 * time.Second)
	}
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	DB.SetMaxOpenConns(25)
	DB.SetMaxIdleConns(5)
	DB.SetConnMaxLifetime(5 * time.Minute)

	log.Println("Database connected")
}

func RunMigrations() {
	migration, err := os.ReadFile("migrations/001_init.sql")
	if err != nil {
		log.Fatalf("Failed to read migration file: %v", err)
	}

	_, err = DB.Exec(string(migration))
	if err != nil {
		log.Printf("Migration batch warning: %v", err)
		log.Println("Retrying migration statements individually...")
		// If the batch fails, try each statement separately so partial failures
		// don't block creation of subsequent tables
		runMigrationStatements(string(migration))
	}
	log.Println("Migrations applied")
}

// runMigrationStatements splits SQL into top-level statements and executes each independently.
// This ensures that a failure in one statement (e.g., a duplicate index) doesn't prevent
// creation of subsequent tables.
func runMigrationStatements(sql string) {
	stmts := splitSQL(sql)
	for i, stmt := range stmts {
		if stmt == "" {
			continue
		}
		_, err := DB.Exec(stmt)
		if err != nil {
			log.Printf("  statement %d warning: %v", i+1, err)
		}
	}
}

// splitSQL splits a SQL string into top-level statements, respecting DO $$ ... $$ blocks.
func splitSQL(sql string) []string {
	var stmts []string
	var current []byte
	inDollar := false
	i := 0
	for i < len(sql) {
		if !inDollar && sql[i] == '$' && i+1 < len(sql) && sql[i+1] == '$' {
			current = append(current, '$', '$')
			i += 2
			inDollar = true
			continue
		}
		if inDollar && sql[i] == '$' && i+1 < len(sql) && sql[i+1] == '$' {
			current = append(current, '$', '$')
			i += 2
			inDollar = false
			continue
		}
		if !inDollar && sql[i] == ';' {
			stmt := strings.TrimSpace(string(current))
			if stmt != "" {
				stmts = append(stmts, stmt)
			}
			current = current[:0]
			i++
			continue
		}
		current = append(current, sql[i])
		i++
	}
	if stmt := strings.TrimSpace(string(current)); stmt != "" {
		stmts = append(stmts, stmt)
	}
	return stmts
}

func Seed() {
	// no-op — called from main with hashed passwords
}

func SeedWithPasswords(adminHash, demoOwnerHash, demoMasterHash string) {
	allPerms := `{"checks_view":true,"checks_create":true,"checks_edit":true,"checks_delete":true,"profit_view":true,"clients_view":true,"clients_edit":true,"warehouse_access":true,"suppliers_access":true,"financial_reports":true,"export_data":true,"user_management":true}`
	masterPerms := `{"checks_view":true,"checks_create":true,"checks_edit":false,"checks_delete":false,"profit_view":false,"clients_view":true,"clients_edit":false,"warehouse_access":false,"suppliers_access":false,"financial_reports":false,"export_data":false,"user_management":false}`

	// ── 1. Seed default plans ──
	seedPlans()

	// ── 2. Platform owner (superadmin) — NO tenant ──
	log.Println("Seed: creating superadmin +79884444436...")
	_, err := DB.Exec(`
		INSERT INTO users (phone, password, full_name, role, is_active, tenant_id, permissions, salary_percent)
		VALUES ('+79884444436', $1, 'Администратор платформы', 'superadmin', true, NULL, $2, 0)
		ON CONFLICT (phone) DO UPDATE SET
			password = EXCLUDED.password,
			full_name = EXCLUDED.full_name,
			role = EXCLUDED.role,
			is_active = true,
			tenant_id = NULL,
			permissions = EXCLUDED.permissions
	`, adminHash, allPerms)
	if err != nil {
		log.Printf("Seed superadmin FAILED: %v", err)
		// Try simpler insert without permissions column as fallback
		_, err2 := DB.Exec(`
			INSERT INTO users (phone, password, full_name, role, is_active, tenant_id)
			VALUES ('+79884444436', $1, 'Администратор платформы', 'superadmin', true, NULL)
			ON CONFLICT (phone) DO UPDATE SET
				password = EXCLUDED.password, full_name = EXCLUDED.full_name,
				role = EXCLUDED.role, is_active = true, tenant_id = NULL
		`, adminHash)
		if err2 != nil {
			log.Printf("Seed superadmin fallback also FAILED: %v", err2)
		} else {
			log.Println("Seed superadmin created (fallback without permissions)")
		}
	} else {
		log.Println("Seed superadmin OK")
	}

	// ── 3. Demo tenant (separate auto service) ──
	// NEVER rename or modify existing tenants — only create demo if missing
	var tenantID string
	err = DB.QueryRow(`SELECT id FROM tenants WHERE slug = 'demo' LIMIT 1`).Scan(&tenantID)
	if err != nil {
		// Demo tenant not found — create a new one (only if slug 'demo' doesn't exist)
		err = DB.QueryRow(`
			INSERT INTO tenants (name, slug, phone, is_active, max_users)
			VALUES ('Демо Автосервис', 'demo', '+7 (000) 000-00-01', true, 10)
			RETURNING id
		`).Scan(&tenantID)
		if err != nil {
			log.Printf("Seed: failed to create demo tenant: %v", err)
		}
	}

	if tenantID == "" {
		log.Println("Seed: could not get or create demo tenant, skipping demo users")
	} else {
		// Demo owner (director of the demo auto service)
		_, err = DB.Exec(`
			INSERT INTO users (phone, password, full_name, role, is_active, tenant_id, permissions, salary_percent)
			VALUES ('+70000000001', $1, 'Владелец (демо)', 'director', true, $2, $3, 0)
			ON CONFLICT (phone) DO UPDATE SET
				password = EXCLUDED.password,
				full_name = EXCLUDED.full_name,
				role = EXCLUDED.role,
				is_active = true,
				tenant_id = EXCLUDED.tenant_id,
				permissions = EXCLUDED.permissions
		`, demoOwnerHash, tenantID, allPerms)
		if err != nil {
			log.Printf("Seed demo owner upsert error: %v", err)
		}

		// Demo master
		_, err = DB.Exec(`
			INSERT INTO users (phone, password, full_name, role, is_active, tenant_id, permissions, salary_percent)
			VALUES ('+70000000002', $1, 'Мастер (демо)', 'master', true, $2, $3, 40)
			ON CONFLICT (phone) DO UPDATE SET
				password = EXCLUDED.password,
				full_name = EXCLUDED.full_name,
				role = EXCLUDED.role,
				is_active = true,
				tenant_id = EXCLUDED.tenant_id,
				permissions = EXCLUDED.permissions,
				salary_percent = 40
		`, demoMasterHash, tenantID, masterPerms)
		if err != nil {
			log.Printf("Seed demo master upsert error: %v", err)
		}
	}

	fmt.Println("Seed completed (upsert): superadmin (no tenant) + demo tenant + demo users")
	fmt.Println("Platform admin: +79884444436 / admin123")
	fmt.Println("Demo owner:     +70000000001 / demo123")
	fmt.Println("Demo master:    +70000000002 / demo123")
}

func seedPlans() {
	// Insert default plans if none exist
	var count int
	DB.QueryRow("SELECT COUNT(*) FROM plans").Scan(&count)
	if count > 0 {
		return
	}

	plans := []struct {
		name     string
		price    float64
		desc     string
		features string
		maxUsers int
		sort     int
	}{
		{
			"Старт",
			1500,
			"Для небольших автосервисов",
			`["До 3 сотрудников","Заказ-наряды","Клиенты и авто","Базовая отчётность"]`,
			3,
			1,
		},
		{
			"Бизнес",
			3000,
			"Оптимальный для растущего бизнеса",
			`["До 10 сотрудников","Заказ-наряды","Клиенты и авто","Склад и поставщики","Финансовые отчёты","Графики работы"]`,
			10,
			2,
		},
		{
			"Премиум",
			5000,
			"Для крупных автосервисов",
			`["Безлимит сотрудников","Все функции Бизнес","Экспорт данных","Приоритетная поддержка"]`,
			50,
			3,
		},
	}

	for _, p := range plans {
		DB.Exec(`
			INSERT INTO plans (name, monthly_price, description, features, max_users, is_active, sort_order)
			VALUES ($1, $2, $3, $4, $5, true, $6)
		`, p.name, p.price, p.desc, p.features, p.maxUsers, p.sort)
	}

	log.Println("Default plans seeded")
}
