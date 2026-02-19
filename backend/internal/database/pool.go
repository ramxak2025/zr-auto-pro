package database

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"zr-auto-pro/internal/config"
)

// Pool is the global pgxpool connection pool. Use this for all database operations.
var Pool *pgxpool.Pool

// Connect creates a pgxpool connection pool with the given config.
// It retries up to 30 times with 2-second intervals.
func Connect(cfg *config.Config) {
	poolCfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to parse DATABASE_URL: %v", err)
	}

	poolCfg.MaxConns = cfg.PoolMaxConns
	poolCfg.MinConns = cfg.PoolMinConns
	poolCfg.MaxConnLifetime = cfg.PoolMaxConnLife
	poolCfg.MaxConnIdleTime = cfg.PoolMaxConnIdle
	poolCfg.HealthCheckPeriod = cfg.PoolHealthCheck
	poolCfg.ConnConfig.ConnectTimeout = cfg.PoolConnTimeout

	ctx := context.Background()

	for i := 0; i < 30; i++ {
		Pool, err = pgxpool.NewWithConfig(ctx, poolCfg)
		if err == nil {
			err = Pool.Ping(ctx)
		}
		if err == nil {
			log.Println("Database connected (pgxpool)")
			return
		}
		log.Printf("Waiting for database... attempt %d/30: %v", i+1, err)
		time.Sleep(2 * time.Second)
	}
	log.Fatalf("Failed to connect to database after 30 attempts: %v", err)
}

// Close shuts down the connection pool.
func Close() {
	if Pool != nil {
		Pool.Close()
		log.Println("Database connection pool closed")
	}
}

// RunMigrations applies SQL migration files at startup.
func RunMigrations() {
	migration, err := os.ReadFile("migrations/001_init.sql")
	if err != nil {
		log.Fatalf("Failed to read migration file: %v", err)
	}

	ctx := context.Background()
	_, err = Pool.Exec(ctx, string(migration))
	if err != nil {
		log.Printf("Migration batch warning: %v", err)
		log.Println("Retrying migration statements individually...")
		runMigrationStatements(ctx, string(migration))
	}
	log.Println("Migrations applied")
}

func runMigrationStatements(ctx context.Context, sql string) {
	stmts := splitSQL(sql)
	for i, stmt := range stmts {
		if stmt == "" {
			continue
		}
		_, err := Pool.Exec(ctx, stmt)
		if err != nil {
			log.Printf("  statement %d warning: %v", i+1, err)
		}
	}
}

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

// SeedWithPasswords creates default users and plans.
func SeedWithPasswords(adminHash, demoOwnerHash, demoMasterHash string) {
	ctx := context.Background()
	allPerms := `{"checks_view":true,"checks_create":true,"checks_edit":true,"checks_delete":true,"profit_view":true,"clients_view":true,"clients_edit":true,"warehouse_access":true,"suppliers_access":true,"financial_reports":true,"export_data":true,"user_management":true}`
	masterPerms := `{"checks_view":true,"checks_create":true,"checks_edit":false,"checks_delete":false,"profit_view":false,"clients_view":true,"clients_edit":false,"warehouse_access":false,"suppliers_access":false,"financial_reports":false,"export_data":false,"user_management":false}`

	seedPlans(ctx)

	log.Println("Seed: creating superadmin +79884444436...")
	_, err := Pool.Exec(ctx, `
		INSERT INTO users (phone, password, full_name, role, is_active, tenant_id, permissions, salary_percent)
		VALUES ('+79884444436', $1, 'Администратор платформы', 'superadmin', true, NULL, $2, 0)
		ON CONFLICT (phone) DO UPDATE SET
			password = EXCLUDED.password, full_name = EXCLUDED.full_name,
			role = EXCLUDED.role, is_active = true, tenant_id = NULL, permissions = EXCLUDED.permissions
	`, adminHash, allPerms)
	if err != nil {
		log.Printf("Seed superadmin FAILED: %v", err)
	} else {
		log.Println("Seed superadmin OK")
	}

	var tenantID string
	err = Pool.QueryRow(ctx, `SELECT id FROM tenants WHERE slug = 'demo' LIMIT 1`).Scan(&tenantID)
	if err != nil {
		err = Pool.QueryRow(ctx, `
			INSERT INTO tenants (name, slug, phone, is_active, max_users)
			VALUES ('Демо Автосервис', 'demo', '+7 (000) 000-00-01', true, 10) RETURNING id
		`).Scan(&tenantID)
		if err != nil {
			log.Printf("Seed: failed to create demo tenant: %v", err)
		}
	}

	if tenantID == "" {
		log.Println("Seed: could not get or create demo tenant, skipping demo users")
		return
	}

	Pool.Exec(ctx, `
		INSERT INTO users (phone, password, full_name, role, is_active, tenant_id, permissions, salary_percent)
		VALUES ('+70000000001', $1, 'Владелец (демо)', 'director', true, $2, $3, 0)
		ON CONFLICT (phone) DO UPDATE SET
			password = EXCLUDED.password, full_name = EXCLUDED.full_name,
			role = EXCLUDED.role, is_active = true, tenant_id = EXCLUDED.tenant_id, permissions = EXCLUDED.permissions
	`, demoOwnerHash, tenantID, allPerms)

	Pool.Exec(ctx, `
		INSERT INTO users (phone, password, full_name, role, is_active, tenant_id, permissions, salary_percent)
		VALUES ('+70000000002', $1, 'Мастер (демо)', 'master', true, $2, $3, 40)
		ON CONFLICT (phone) DO UPDATE SET
			password = EXCLUDED.password, full_name = EXCLUDED.full_name,
			role = EXCLUDED.role, is_active = true, tenant_id = EXCLUDED.tenant_id,
			permissions = EXCLUDED.permissions, salary_percent = 40
	`, demoMasterHash, tenantID, masterPerms)

	fmt.Println("Seed completed: superadmin + demo tenant + demo users")
	fmt.Println("Platform admin: +79884444436 / admin123")
	fmt.Println("Demo owner:     +70000000001 / demo123")
	fmt.Println("Demo master:    +70000000002 / demo123")
}

func seedPlans(ctx context.Context) {
	var count int
	if err := Pool.QueryRow(ctx, "SELECT COUNT(*) FROM plans").Scan(&count); err != nil {
		log.Printf("Seed plans count check error: %v", err)
		return
	}
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
		{"Старт", 1500, "Для небольших автосервисов", `["До 3 сотрудников","Заказ-наряды","Клиенты и авто","Базовая отчётность"]`, 3, 1},
		{"Бизнес", 3000, "Оптимальный для растущего бизнеса", `["До 10 сотрудников","Заказ-наряды","Клиенты и авто","Склад и поставщики","Финансовые отчёты","Графики работы"]`, 10, 2},
		{"Премиум", 5000, "Для крупных автосервисов", `["Безлимит сотрудников","Все функции Бизнес","Экспорт данных","Приоритетная поддержка"]`, 50, 3},
	}

	for _, p := range plans {
		_, err := Pool.Exec(ctx, `
			INSERT INTO plans (name, monthly_price, description, features, max_users, is_active, sort_order)
			VALUES ($1, $2, $3, $4, $5, true, $6)
		`, p.name, p.price, p.desc, p.features, p.maxUsers, p.sort)
		if err != nil {
			log.Printf("Seed plan %q error: %v", p.name, err)
		}
	}
	log.Println("Default plans seeded")
}
