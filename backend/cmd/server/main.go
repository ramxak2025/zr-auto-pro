package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"zr-auto-pro/internal/database"
	"zr-auto-pro/internal/handlers"
	"zr-auto-pro/internal/middleware"
)

func main() {
	log.Println("Starting ZR Auto Pro backend (Go)...")

	database.Connect()
	database.RunMigrations()

	// Seed with hashed passwords
	adminHash, err := bcrypt.GenerateFromPassword([]byte("admin123"), 10)
	if err != nil {
		log.Printf("WARN: failed to hash admin password: %v", err)
	}
	demoHash, err := bcrypt.GenerateFromPassword([]byte("demo123"), 10)
	if err != nil {
		log.Printf("WARN: failed to hash demo password: %v", err)
	}
	database.SeedWithPasswords(string(adminHash), string(demoHash), string(demoHash))

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()

	// Recovery middleware — prevents panics from crashing the server
	r.Use(gin.Recovery())

	// Structured logging middleware
	r.Use(gin.LoggerWithConfig(gin.LoggerConfig{
		SkipPaths: []string{"/api/health"},
	}))

	r.Use(cors.New(cors.Config{
		AllowAllOrigins: true,
		AllowMethods:    []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:    []string{"Origin", "Content-Type", "Authorization"},
	}))

	// Static files for uploads
	r.Static("/api/uploads", "./uploads")

	api := r.Group("/api")

	// Health check — lightweight, for Docker and load balancers
	api.GET("/health", func(c *gin.Context) {
		if err := database.DB.Ping(); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"status": "unhealthy",
				"error":  "database unreachable",
			})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// Diagnostic endpoint — shows DB state for debugging login issues
	api.GET("/health/db", func(c *gin.Context) {
		result := gin.H{}

		// 1. DB connection
		if err := database.DB.Ping(); err != nil {
			result["db"] = fmt.Sprintf("FAIL: %v", err)
			c.JSON(200, result)
			return
		}
		result["db"] = "OK"

		// 2. Tables
		tables := []string{"plans", "tenants", "users", "clients", "checks", "services", "products"}
		tblStatus := map[string]string{}
		for _, t := range tables {
			var exists bool
			database.DB.QueryRow("SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name=$1)", t).Scan(&exists)
			if exists {
				tblStatus[t] = "exists"
			} else {
				tblStatus[t] = "MISSING"
			}
		}
		result["tables"] = tblStatus

		// 3. Users table columns
		colRows, err := database.DB.Query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='users' ORDER BY ordinal_position")
		cols := []string{}
		if err == nil && colRows != nil {
			defer colRows.Close()
			for colRows.Next() {
				var name, dtype string
				if scanErr := colRows.Scan(&name, &dtype); scanErr == nil {
					cols = append(cols, name+"("+dtype+")")
				}
			}
		}
		result["users_columns"] = cols

		// 4. All users
		userRows, err := database.DB.Query("SELECT phone, role, is_active FROM users ORDER BY created_at")
		users := []gin.H{}
		if err == nil && userRows != nil {
			defer userRows.Close()
			for userRows.Next() {
				var phone, role string
				var active bool
				if scanErr := userRows.Scan(&phone, &role, &active); scanErr == nil {
					users = append(users, gin.H{"phone": phone, "role": role, "active": active})
				}
			}
		}
		result["users"] = users

		// 5. Admin password check
		var storedHash string
		err = database.DB.QueryRow("SELECT password FROM users WHERE phone='+79884444436'").Scan(&storedHash)
		if err != nil {
			result["admin_check"] = fmt.Sprintf("NOT FOUND: %v", err)
		} else if bcrypt.CompareHashAndPassword([]byte(storedHash), []byte("admin123")) == nil {
			result["admin_check"] = "OK (password=admin123 matches)"
		} else {
			result["admin_check"] = "FAIL (password mismatch)"
		}

		// 6. Role constraint
		var constraintDef string
		database.DB.QueryRow(`
			SELECT pg_get_constraintdef(oid) FROM pg_constraint
			WHERE conrelid = 'users'::regclass AND contype = 'c' AND conname LIKE '%role%'
		`).Scan(&constraintDef)
		if constraintDef != "" {
			result["role_constraint"] = constraintDef
		}

		c.JSON(200, result)
	})

	// Auth (public)
	api.POST("/auth/login", handlers.Login)
	api.POST("/auth/register", handlers.Register)

	// Protected routes
	auth := api.Group("")
	auth.Use(middleware.JWTAuth())

	// Auth
	auth.GET("/auth/me", handlers.Me)

	// Users
	auth.GET("/users", handlers.GetUsers)
	auth.GET("/users/masters", handlers.GetMasters)
	auth.GET("/users/:id", handlers.GetUser)
	auth.POST("/users", handlers.CreateUser)
	auth.PATCH("/users/:id", handlers.UpdateUser)
	auth.DELETE("/users/:id", handlers.DeleteUser)

	// Clients
	auth.GET("/clients", handlers.GetClients)
	auth.GET("/clients/:id", handlers.GetClient)
	auth.POST("/clients", handlers.CreateClient)
	auth.PATCH("/clients/:id", handlers.UpdateClient)
	auth.DELETE("/clients/:id", handlers.DeleteClient)

	// Cars
	auth.GET("/cars", handlers.GetCars)
	auth.GET("/cars/:id", handlers.GetCar)
	auth.POST("/cars", handlers.CreateCar)
	auth.PATCH("/cars/:id", handlers.UpdateCar)
	auth.DELETE("/cars/:id", handlers.DeleteCar)

	// Services
	auth.GET("/services", handlers.GetServices)
	auth.GET("/services/:id", handlers.GetService)
	auth.POST("/services", handlers.CreateService)
	auth.PATCH("/services/:id", handlers.UpdateService)
	auth.DELETE("/services/:id", handlers.DeleteService)

	// Products
	auth.GET("/products", handlers.GetProducts)
	auth.GET("/products/low-stock", handlers.GetProductsLowStock)
	auth.GET("/products/movements", handlers.GetStockMovements)
	auth.GET("/products/:id", handlers.GetProduct)
	auth.POST("/products", handlers.CreateProduct)
	auth.PATCH("/products/:id", handlers.UpdateProduct)
	auth.DELETE("/products/:id", handlers.DeleteProduct)
	auth.POST("/products/:id/stock", handlers.UpdateStock)

	// Checks
	auth.GET("/checks", handlers.GetChecks)
	auth.GET("/checks/dashboard", handlers.GetDashboard)
	auth.GET("/checks/ranking", handlers.GetRanking)
	auth.GET("/checks/:id", handlers.GetCheck)
	auth.POST("/checks", handlers.CreateCheck)
	auth.PATCH("/checks/:id", handlers.UpdateCheck)
	auth.DELETE("/checks/:id", handlers.DeleteCheck)

	// Suppliers
	auth.GET("/suppliers", handlers.GetSuppliers)
	auth.GET("/suppliers/deliveries", handlers.GetDeliveries)
	auth.GET("/suppliers/payments", handlers.GetPayments)
	auth.GET("/suppliers/:id", handlers.GetSupplier)
	auth.GET("/suppliers/deliveries/:id", handlers.GetDelivery)
	auth.POST("/suppliers", handlers.CreateSupplier)
	auth.POST("/suppliers/deliveries", handlers.CreateDelivery)
	auth.POST("/suppliers/payments", handlers.CreatePayment)
	auth.PATCH("/suppliers/:id", handlers.UpdateSupplier)
	auth.DELETE("/suppliers/:id", handlers.DeleteSupplier)

	// Salary
	auth.GET("/salary", handlers.GetSalaries)
	auth.GET("/salary/my", handlers.GetMySalary)

	// Reports
	auth.GET("/reports/financial", handlers.GetFinancialReport)
	auth.GET("/reports/cashflow", handlers.GetCashFlow)

	// Shifts
	auth.GET("/shifts", handlers.GetShifts)
	auth.GET("/shifts/my", handlers.GetMyShifts)
	auth.POST("/shifts/open", handlers.OpenShift)
	auth.POST("/shifts/:id/close", handlers.CloseShift)

	// Schedule
	auth.GET("/schedule", handlers.GetSchedule)
	auth.GET("/schedule/work-modes", handlers.GetWorkModes)
	auth.GET("/schedule/today", handlers.GetTodaySchedule)
	auth.GET("/schedule/my-stats", handlers.GetMyStats)
	auth.POST("/schedule", handlers.CreateScheduleEntry)
	auth.POST("/schedule/work-modes", handlers.CreateWorkMode)
	auth.PATCH("/schedule/:id", handlers.UpdateScheduleEntry)
	auth.PATCH("/schedule/work-modes/:id", handlers.UpdateWorkMode)
	auth.DELETE("/schedule/:id", handlers.DeleteScheduleEntry)

	// Tenants (admin)
	auth.GET("/tenants", handlers.GetTenants)
	auth.GET("/tenants/stats", handlers.GetTenantStats)
	auth.GET("/tenants/:id", handlers.GetTenant)
	auth.POST("/tenants", handlers.CreateTenant)
	auth.PATCH("/tenants/:id", handlers.UpdateTenant)
	auth.DELETE("/tenants/:id", handlers.DeleteTenant)

	// Plans (admin CRUD + public read)
	auth.GET("/plans", handlers.GetPlans)
	auth.POST("/plans", handlers.CreatePlan)
	auth.PATCH("/plans/:id", handlers.UpdatePlan)
	auth.DELETE("/plans/:id", handlers.DeletePlan)

	// Subscription (tenant users)
	auth.GET("/subscription", handlers.GetSubscription)

	// Uploads
	auth.POST("/uploads", handlers.UploadFile)

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	// Graceful shutdown
	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      r,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		log.Printf("Server running on :%s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	database.Close()
	log.Println("Server stopped")
}
