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
	var count int
	err := DB.QueryRow("SELECT COUNT(*) FROM users WHERE role='superadmin'").Scan(&count)
	if err != nil {
		log.Printf("Seed check error: %v", err)
		return
	}
	if count > 0 {
		log.Println("Superadmin exists, skipping seed")
		return
	}

	// Import bcrypt here
	// We hash in the seed function of main to avoid circular deps
	log.Println("Seed: creating superadmin + demo users...")

	// This will be called from main with the hashed passwords
}

func SeedWithPasswords(adminHash, demoOwnerHash, demoMasterHash string) {
	var count int
	err := DB.QueryRow("SELECT COUNT(*) FROM users WHERE role='superadmin'").Scan(&count)
	if err != nil {
		log.Printf("Seed check error: %v", err)
		return
	}
	if count > 0 {
		log.Println("Superadmin exists, skipping seed")
		return
	}

	tx, err := DB.Begin()
	if err != nil {
		log.Fatalf("Seed tx error: %v", err)
	}

	// Create main tenant
	var tenantID string
	err = tx.QueryRow(`
		INSERT INTO tenants (name, slug, phone, is_active, max_users)
		VALUES ('ZR Auto Pro', 'zr-auto', '+7 (988) 444-44-36', true, 50)
		RETURNING id
	`).Scan(&tenantID)
	if err != nil {
		tx.Rollback()
		log.Fatalf("Seed tenant error: %v", err)
	}

	allPerms := `{"checks_view":true,"checks_create":true,"checks_edit":true,"checks_delete":true,"profit_view":true,"clients_view":true,"clients_edit":true,"warehouse_access":true,"suppliers_access":true,"financial_reports":true,"export_data":true,"user_management":true}`

	// Superadmin
	_, err = tx.Exec(`
		INSERT INTO users (phone, password, full_name, role, is_active, tenant_id, permissions, salary_percent)
		VALUES ($1, $2, 'Администратор', 'superadmin', true, $3, $4, 0)
	`, "+79884444436", adminHash, tenantID, allPerms)
	if err != nil {
		tx.Rollback()
		log.Fatalf("Seed admin error: %v", err)
	}

	// Demo owner (director)
	_, err = tx.Exec(`
		INSERT INTO users (phone, password, full_name, role, is_active, tenant_id, permissions, salary_percent)
		VALUES ($1, $2, 'Владелец (демо)', 'director', true, $3, $4, 0)
	`, "+70000000001", demoOwnerHash, tenantID, allPerms)
	if err != nil {
		tx.Rollback()
		log.Fatalf("Seed demo owner error: %v", err)
	}

	// Demo master
	masterPerms := `{"checks_view":true,"checks_create":true,"checks_edit":false,"checks_delete":false,"profit_view":false,"clients_view":true,"clients_edit":false,"warehouse_access":false,"suppliers_access":false,"financial_reports":false,"export_data":false,"user_management":false}`
	_, err = tx.Exec(`
		INSERT INTO users (phone, password, full_name, role, is_active, tenant_id, permissions, salary_percent)
		VALUES ($1, $2, 'Мастер (демо)', 'master', true, $3, $4, 40)
	`, "+70000000002", demoMasterHash, tenantID, masterPerms)
	if err != nil {
		tx.Rollback()
		log.Fatalf("Seed demo master error: %v", err)
	}

	err = tx.Commit()
	if err != nil {
		log.Fatalf("Seed commit error: %v", err)
	}

	fmt.Println("Seed completed: tenant + superadmin + demo users created")
	fmt.Println("Superadmin: +79884444436 / admin123")
	fmt.Println("Demo owner: +70000000001 / demo123")
	fmt.Println("Demo master: +70000000002 / demo123")
}
