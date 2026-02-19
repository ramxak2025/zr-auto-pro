package main

import (
	"log"
	"os"

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
	adminHash, _ := bcrypt.GenerateFromPassword([]byte("admin123"), 10)
	demoHash, _ := bcrypt.GenerateFromPassword([]byte("demo123"), 10)
	database.SeedWithPasswords(string(adminHash), string(demoHash), string(demoHash))

	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()

	r.Use(cors.New(cors.Config{
		AllowAllOrigins:  true,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
	}))

	// Static files for uploads
	r.Static("/api/uploads", "./uploads")

	api := r.Group("/api")

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

	// Uploads
	auth.POST("/uploads", handlers.UploadFile)

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	log.Printf("Server running on :%s", port)
	r.Run(":" + port)
}
