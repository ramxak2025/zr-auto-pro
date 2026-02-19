package database

import (
	"database/sql"
	"fmt"
	"log"
	"os"
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
		log.Fatalf("Failed to read migration: %v", err)
	}

	_, err = DB.Exec(string(migration))
	if err != nil {
		log.Fatalf("Failed to run migration: %v", err)
	}
	log.Println("Migrations applied")
}

func Seed() {
	// no-op — called from main with hashed passwords
}

func SeedWithPasswords(adminHash, demoOwnerHash, demoMasterHash string) {
	allPerms := `{"checks_view":true,"checks_create":true,"checks_edit":true,"checks_delete":true,"profit_view":true,"clients_view":true,"clients_edit":true,"warehouse_access":true,"suppliers_access":true,"financial_reports":true,"export_data":true,"user_management":true}`
	masterPerms := `{"checks_view":true,"checks_create":true,"checks_edit":false,"checks_delete":false,"profit_view":false,"clients_view":true,"clients_edit":false,"warehouse_access":false,"suppliers_access":false,"financial_reports":false,"export_data":false,"user_management":false}`

	// Ensure tenant exists (upsert by slug)
	var tenantID string
	err := DB.QueryRow(`
		INSERT INTO tenants (name, slug, phone, is_active, max_users)
		VALUES ('ZR Auto Pro', 'zr-auto', '+7 (988) 444-44-36', true, 50)
		ON CONFLICT DO NOTHING
		RETURNING id
	`).Scan(&tenantID)
	if err != nil {
		// Tenant might already exist — fetch its ID
		err2 := DB.QueryRow(`SELECT id FROM tenants WHERE slug = 'zr-auto' LIMIT 1`).Scan(&tenantID)
		if err2 != nil {
			// No slug match, try first tenant
			err3 := DB.QueryRow(`SELECT id FROM tenants LIMIT 1`).Scan(&tenantID)
			if err3 != nil {
				// Create fresh without ON CONFLICT
				_ = DB.QueryRow(`
					INSERT INTO tenants (name, slug, phone, is_active, max_users)
					VALUES ('ZR Auto Pro', 'zr-auto', '+7 (988) 444-44-36', true, 50)
					RETURNING id
				`).Scan(&tenantID)
			}
		}
	}

	if tenantID == "" {
		log.Println("Seed: could not get or create tenant, skipping")
		return
	}

	// Upsert superadmin: +79884444436 / admin123
	_, err = DB.Exec(`
		INSERT INTO users (phone, password, full_name, role, is_active, tenant_id, permissions, salary_percent)
		VALUES ('+79884444436', $1, 'Администратор', 'superadmin', true, $2, $3, 0)
		ON CONFLICT (phone) DO UPDATE SET
			password = EXCLUDED.password,
			full_name = EXCLUDED.full_name,
			role = EXCLUDED.role,
			is_active = true,
			tenant_id = EXCLUDED.tenant_id,
			permissions = EXCLUDED.permissions
	`, adminHash, tenantID, allPerms)
	if err != nil {
		log.Printf("Seed admin upsert error: %v", err)
	}

	// Upsert demo owner: +70000000001 / demo123
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

	// Upsert demo master: +70000000002 / demo123
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

	fmt.Println("Seed completed (upsert): tenant + superadmin + demo users ensured")
	fmt.Println("Superadmin: +79884444436 / admin123")
	fmt.Println("Demo owner: +70000000001 / demo123")
	fmt.Println("Demo master: +70000000002 / demo123")
}
